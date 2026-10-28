import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestContext, PASSWORD } from './helpers.js';

let ctx;
let adminToken;

beforeAll(async () => {
  ctx = await createTestContext();
});
afterAll(async () => {
  await ctx.pool.end();
});

const api = () => request(ctx.app);
const auth = (token) => ({ Authorization: `Bearer ${token}` });

describe('auth', () => {
  it('reports setup state before the first user exists', async () => {
    const res = await api().get('/api/auth/status');
    expect(res.body).toMatchObject({
      setupRequired: true,
      registrationOpen: true,
      anonymousMode: false,
    });
  });

  it('rejects weak passwords with an error code', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ email: 'admin@example.com', password: 'short', display_name: 'Admin' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PASSWORD_TOO_SHORT');
  });

  it('makes the first registered user an admin', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ email: 'Admin@Example.com', password: PASSWORD, display_name: 'Admin' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'admin@example.com', role: 'admin' });
    expect(res.body.user.password_hash).toBeUndefined();
    adminToken = res.body.token;
  });

  it('closes registration after the first user by default', async () => {
    const res = await api()
      .post('/api/auth/register')
      .send({ email: 'other@example.com', password: PASSWORD, display_name: 'Other' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('REGISTRATION_CLOSED');
  });

  it('logs in case-insensitively and rejects wrong passwords', async () => {
    const ok = await api()
      .post('/api/auth/login')
      .send({ email: 'ADMIN@example.com', password: PASSWORD });
    expect(ok.status).toBe(200);
    const bad = await api()
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'wrong-password' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    const unknown = await api()
      .post('/api/auth/login')
      .send({ email: 'nobody@example.com', password: 'x' });
    expect(unknown.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('rejects tampered tokens', async () => {
    const res = await api()
      .get('/api/pets')
      .set(auth(`${adminToken}x`));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_TOKEN');
  });

  it('requires a login for data routes', async () => {
    const res = await api().get('/api/pets');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_REQUIRED');
  });

  it('does not allow disabling the login requirement unless the server allows it', async () => {
    const res = await api()
      .put('/api/admin/settings')
      .set(auth(adminToken))
      .send({ requireLogin: false });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('ANONYMOUS_MODE_NOT_ALLOWED');
  });

  it('lets an admin open registration; new users are not admins', async () => {
    await api()
      .put('/api/admin/settings')
      .set(auth(adminToken))
      .send({ allowRegistration: true })
      .expect(200);
    const res = await api()
      .post('/api/auth/register')
      .send({ email: 'user@example.com', password: PASSWORD, display_name: 'User' });
    expect(res.body.user.role).toBe('user');
    const admin = await api().get('/api/admin/settings').set(auth(res.body.token));
    expect(admin.status).toBe(403);
  });
});

describe('password change', () => {
  it('invalidates older tokens and returns a new one', async () => {
    const login = await api()
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: PASSWORD });
    const oldToken = login.body.token;
    // JWT iat has second precision: make sure the change happens in a later second.
    await new Promise((r) => setTimeout(r, 1100));
    const res = await api()
      .post('/api/auth/password')
      .set(auth(oldToken))
      .send({ current_password: PASSWORD, new_password: `${PASSWORD}-new` });
    expect(res.status).toBe(200);
    expect((await api().get('/api/pets').set(auth(oldToken))).body.error.code).toBe(
      'AUTH_INVALID_TOKEN',
    );
    expect((await api().get('/api/pets').set(auth(res.body.token))).status).toBe(200);
  });

  it('rejects a wrong current password', async () => {
    const res = await api()
      .post('/api/auth/password')
      .set(auth(adminToken))
      .send({ current_password: 'wrong-password', new_password: 'another-long-password' });
    expect(res.body.error.code).toBe('AUTH_WRONG_PASSWORD');
  });
});

describe('pets and related data', () => {
  let petId;

  it('creates, lists and updates a pet', async () => {
    const created = await api()
      .post('/api/pets')
      .set(auth(adminToken))
      .send({ name: 'Testy', species: 'cat', birth_date: '2022-05-01', breed: '' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: 'Testy',
      species: 'cat',
      breed: null,
      birth_date: '2022-05-01',
    });
    petId = created.body.id;

    const list = await api().get('/api/pets').set(auth(adminToken));
    expect(list.body.map((p) => p.name)).toContain('Testy');

    const updated = await api()
      .patch(`/api/pets/${petId}`)
      .set(auth(adminToken))
      .send({ name: 'Testy II' });
    expect(updated.body.name).toBe('Testy II');
  });

  it('validates input and ignores unknown columns', async () => {
    const res = await api()
      .post('/api/pets')
      .set(auth(adminToken))
      .send({ name: 'X', species: 'dragon', 'id; DROP TABLE pets': 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('records doses and keeps stock consistent', async () => {
    const med = await api()
      .post(`/api/pets/${petId}/medications`)
      .set(auth(adminToken))
      .send({
        name: 'Drops',
        dose: 2,
        unit: 'drops',
        times: ['08:00'],
        start_date: '2026-01-01',
        stock: 5,
      });
    expect(med.status).toBe(201);
    const dose = await api()
      .post(`/api/pets/${petId}/medications/${med.body.id}/doses`)
      .set(auth(adminToken))
      .send({});
    expect(dose.body.medication.stock).toBe(3);
    await api()
      .delete(`/api/pets/${petId}/medications/${med.body.id}/doses/${dose.body.dose.id}`)
      .set(auth(adminToken))
      .expect(204);
    const after = await api()
      .get(`/api/pets/${petId}/medications/${med.body.id}`)
      .set(auth(adminToken));
    expect(after.body.stock).toBe(5);
  });

  it('keeps stock empty (null) when it is not tracked', async () => {
    const med = await api()
      .post(`/api/pets/${petId}/medications`)
      .set(auth(adminToken))
      .send({ name: 'Untracked', dose: 1, start_date: '2026-01-01' });
    const dose = await api()
      .post(`/api/pets/${petId}/medications/${med.body.id}/doses`)
      .set(auth(adminToken))
      .send({});
    expect(dose.body.medication.stock).toBeNull();
  });

  it('rejects invalid times of day', async () => {
    const res = await api()
      .post(`/api/pets/${petId}/medications`)
      .set(auth(adminToken))
      .send({ name: 'Bad', times: ['25:00'], start_date: '2026-01-01' });
    expect(res.status).toBe(400);
  });

  it('scopes nested resources to their pet', async () => {
    const other = await api().post('/api/pets').set(auth(adminToken)).send({ name: 'Other' });
    const illness = await api()
      .post(`/api/pets/${petId}/illnesses`)
      .set(auth(adminToken))
      .send({ title: 'Cold', started_on: '2026-02-01' });
    const res = await api()
      .get(`/api/pets/${other.body.id}/illnesses/${illness.body.id}`)
      .set(auth(adminToken));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ILLNESS_NOT_FOUND');
    const entry = await api()
      .post(`/api/pets/${petId}/illnesses/${illness.body.id}/entries`)
      .set(auth(adminToken))
      .send({ date: '2026-02-02', severity: 3, symptoms: 'Sneezing' });
    expect(entry.status).toBe(201);
  });

  it('returns a dashboard summary', async () => {
    const res = await api().get('/api/dashboard').set(auth(adminToken));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('doses');
    expect(res.body.pets.length).toBeGreaterThan(0);
  });
});

describe('photo uploads', () => {
  let petId;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(64),
  ]);

  beforeAll(async () => {
    const res = await api().post('/api/pets').set(auth(adminToken)).send({ name: 'Photogenic' });
    petId = res.body.id;
  });

  it('accepts real images and stores them under a random name', async () => {
    const res = await api()
      .post(`/api/pets/${petId}/photo`)
      .set(auth(adminToken))
      .attach('photo', png, { filename: '../../evil.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.photo).toMatch(/^[0-9a-f-]{36}\.png$/);
    const file = await api().get(`/uploads/${res.body.photo}`);
    expect(file.status).toBe(200);
    expect(file.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects files whose content is not an image, whatever the MIME type says', async () => {
    const res = await api()
      .post(`/api/pets/${petId}/photo`)
      .set(auth(adminToken))
      .attach('photo', Buffer.from('<html><script>alert(1)</script></html>'.padEnd(100)), {
        filename: 'x.png',
        contentType: 'image/png',
      });
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe('UPLOAD_UNSUPPORTED_TYPE');
  });

  it('rejects oversized files', async () => {
    const big = Buffer.concat([png, Buffer.alloc(ctx.config.maxUploadBytes)]);
    const res = await api()
      .post(`/api/pets/${petId}/photo`)
      .set(auth(adminToken))
      .attach('photo', big, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('UPLOAD_TOO_LARGE');
  });
});

describe('security headers', () => {
  it('sets helmet headers and hides the framework', async () => {
    const res = await api().get('/api/healthz');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
  it('returns JSON errors for unknown endpoints and malformed JSON', async () => {
    expect((await api().get('/api/nope')).body.error.code).toBe('AUTH_REQUIRED');
    expect((await api().get('/api/nope').set(auth(adminToken))).body.error.code).toBe('NOT_FOUND');
    const bad = await api()
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(bad.body.error.code).toBe('INVALID_JSON');
  });
});

describe('website icon', () => {
  const PNG_ICON = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32),
  ]);
  let userToken;

  it('is empty by default and visible in the public status', async () => {
    const res = await api().get('/api/auth/status');
    expect(res.body.siteIcon).toBeNull();
  });

  it('can only be changed by admins', async () => {
    await api()
      .post('/api/auth/register')
      .send({
        email: 'plain@example.com',
        password: PASSWORD,
        display_name: 'P',
        invite_code: (await api().post('/api/household/invite').set(auth(adminToken))).body
          .invite_code,
      })
      .expect(201)
      .then((r) => (userToken = r.body.token));
    await api()
      .post('/api/admin/site-icon')
      .set(auth(userToken))
      .attach('photo', PNG_ICON, 'i.png')
      .expect(403);
    await api().delete('/api/admin/site-icon').set(auth(userToken)).expect(403);
    await api().post('/api/admin/site-icon').attach('photo', PNG_ICON, 'i.png').expect(401);
  });

  it('uploads, replaces and resets the icon', async () => {
    const up = await api()
      .post('/api/admin/site-icon')
      .set(auth(adminToken))
      .attach('photo', PNG_ICON, 'i.png')
      .expect(201);
    expect((await api().get('/api/auth/status')).body.siteIcon).toBe(up.body.siteIcon);
    const again = await api()
      .post('/api/admin/site-icon')
      .set(auth(adminToken))
      .attach('photo', PNG_ICON, 'i.png')
      .expect(201);
    expect(again.body.siteIcon).not.toBe(up.body.siteIcon);
    await api().get(`/uploads/${again.body.siteIcon}`).expect(200);
    await api().get(`/uploads/${up.body.siteIcon}`).expect(404);
    await api()
      .post('/api/admin/site-icon')
      .set(auth(adminToken))
      .attach('photo', Buffer.from('<svg onload=alert(1)></svg> padding'), 'i.svg')
      .expect(415);
    const reset = await api().delete('/api/admin/site-icon').set(auth(adminToken)).expect(200);
    expect(reset.body.siteIcon).toBeNull();
    await api().get(`/uploads/${again.body.siteIcon}`).expect(404);
  });
});
