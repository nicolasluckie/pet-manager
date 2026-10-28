import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createTestContext, PASSWORD } from './helpers.js';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);

describe('pet wiki access, privacy and cleanup', () => {
  let ctx;
  let tokenA;
  let tokenB;
  let petId;
  const api = () => request(ctx.app);
  const auth = (token) => ({ Authorization: `Bearer ${token}` });
  const put = (token, id, body) => api().put(`/api/pets/${id}/wiki`).set(auth(token)).send(body);
  const base = { published: true, content: {}, show: {} };

  beforeAll(async () => {
    ctx = await createTestContext();
    const a = await api()
      .post('/api/auth/register')
      .send({ email: 'a@example.com', password: PASSWORD, display_name: 'A' });
    tokenA = a.body.token;
    await api()
      .put('/api/admin/settings')
      .set(auth(tokenA))
      .send({ allowRegistration: true })
      .expect(200);
    const b = await api()
      .post('/api/auth/register')
      .send({ email: 'b@example.com', password: PASSWORD, display_name: 'B' });
    tokenB = b.body.token;
    const pet = await api()
      .post('/api/pets')
      .set(auth(tokenA))
      .send({ name: 'Mochi', species: 'cat', notes: 'secret vet notes', microchip: '123456789' });
    petId = pet.body.id;
  });
  afterAll(() => ctx.pool.end());

  it('requires a login to read or change the configuration', async () => {
    await api().get(`/api/pets/${petId}/wiki`).expect(401);
    await api().put(`/api/pets/${petId}/wiki`).send(base).expect(401);
    await api().post(`/api/pets/${petId}/wiki/gallery`).expect(401);
  });

  it('hides pets of other households', async () => {
    await api().get(`/api/pets/${petId}/wiki`).set(auth(tokenB)).expect(404);
    await put(tokenB, petId, { ...base, slug: 'stolen' }).expect(404);
    await api().get(`/api/pets/${petId}/wiki/preview`).set(auth(tokenB)).expect(404);
    await api()
      .post(`/api/pets/${petId}/wiki/gallery`)
      .set(auth(tokenB))
      .attach('photo', PNG, 'x.png')
      .expect(404);
  });

  it('shows nothing but the name when no field is switched on', async () => {
    await put(tokenA, petId, { ...base, slug: 'mochi' }).expect(200);
    const res = await api().get('/api/public/wiki/mochi').expect(200);
    expect(res.body).toMatchObject({ name: 'Mochi', facts: {}, image: null, sections: {} });
    expect(JSON.stringify(res.body)).not.toMatch(/secret vet notes|123456789/);
  });

  it('never exposes notes or the chip number even with every field enabled', async () => {
    const show = Object.fromEntries(
      [
        'species',
        'breed',
        'sex',
        'color',
        'born',
        'photo',
        'biography',
        'personality',
        'health',
        'neutered',
        'microchipped',
        'vaccinations',
        'allergies',
        'dietaryNotes',
        'favourites',
        'gallery',
        'homeArea',
        'ownerName',
      ].map((k) => [k, true]),
    );
    await put(tokenA, petId, { ...base, slug: 'mochi', show }).expect(200);
    const res = await api().get('/api/public/wiki/mochi').expect(200);
    expect(res.body.sections.health.microchipped).toBe(true);
    expect(JSON.stringify(res.body)).not.toMatch(/secret vet notes|123456789/);
  });

  it('lists vaccinations from the health records (title and date only)', async () => {
    await api()
      .post(`/api/pets/${petId}/health`)
      .set(auth(tokenA))
      .send({
        date: '2026-03-01',
        type: 'vaccination',
        title: 'Rabies',
        notes: 'private lot number',
      })
      .expect(201);
    await api()
      .post(`/api/pets/${petId}/health`)
      .set(auth(tokenA))
      .send({ date: '2026-03-02', type: 'weight', weight_kg: 4.2 })
      .expect(201);
    const wiki = (await api().get(`/api/pets/${petId}/wiki`).set(auth(tokenA))).body;
    await put(tokenA, petId, { ...wiki, show: { ...wiki.show, vaccinations: true } }).expect(200);
    const res = await api().get('/api/public/wiki/mochi').expect(200);
    expect(res.body.sections.health.vaccinations).toEqual([{ name: 'Rabies', date: '2026-03-01' }]);
  });

  it('matches slugs case-insensitively and normalizes them on save', async () => {
    await api().get('/api/public/wiki/MOCHI').expect(200);
    const res = await put(tokenA, petId, { ...base, slug: 'Mochi-Cat' }).expect(200);
    expect(res.body.slug).toBe('mochi-cat');
    await api().get('/api/public/wiki/mochi').expect(404);
    await put(tokenA, petId, { ...base, slug: 'mochi' }).expect(200);
  });

  it.each(['ab', '-bad', 'bad-', 'has space', 'under_score', 'a'.repeat(41)])(
    'rejects the slug %j',
    async (slug) => {
      await put(tokenA, petId, { ...base, slug }).expect(400);
    },
  );

  it('rejects over-long or malformed content', async () => {
    const bad = (content) => put(tokenA, petId, { ...base, slug: 'mochi', content }).expect(400);
    await bad({ infobox: [{ label: '', value: 'x' }] });
    await bad({ infobox: Array.from({ length: 21 }, () => ({ label: 'a', value: 'b' })) });
    await bad({ biography: { content: 'x'.repeat(2001) } });
    await bad({ personality: { traits: Array.from({ length: 31 }, () => 'x') } });
  });

  it('returns 404 for unknown, unpublished and archived pets', async () => {
    await api().get('/api/public/wiki/does-not-exist').expect(404);
    await put(tokenA, petId, { ...base, slug: 'mochi', published: false }).expect(200);
    await api().get('/api/public/wiki/mochi').expect(404);
    await put(tokenA, petId, { ...base, slug: 'mochi' }).expect(200);
    await api().patch(`/api/pets/${petId}`).set(auth(tokenA)).send({ archived: true }).expect(200);
    await api().get('/api/public/wiki/mochi').expect(404);
    await api().patch(`/api/pets/${petId}`).set(auth(tokenA)).send({ archived: false }).expect(200);
    await api().get('/api/public/wiki/mochi').expect(200);
  });

  it('rejects non-image uploads and caps the gallery at 12 images', async () => {
    const url = `/api/pets/${petId}/wiki/gallery`;
    const bad = await api()
      .post(url)
      .set(auth(tokenA))
      .attach('photo', Buffer.from('<html>not an image at all</html>'), 'x.png');
    expect(bad.status).toBe(415);
    for (let i = 0; i < 12; i++)
      await api().post(url).set(auth(tokenA)).attach('photo', PNG, 'x.png').expect(201);
    const full = await api().post(url).set(auth(tokenA)).attach('photo', PNG, 'x.png');
    expect(full.status).toBe(400);
    expect(full.body.error.code).toBe('GALLERY_FULL');
  });

  it('keeps unknown gallery files untouched and 404s on missing images', async () => {
    const res = await api().delete(`/api/pets/${petId}/wiki/gallery/nope.png`).set(auth(tokenA));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('WIKI_IMAGE_NOT_FOUND');
  });

  it('removes the wiki and its uploaded images when the pet is deleted', async () => {
    const wiki = (await api().get(`/api/pets/${petId}/wiki`).set(auth(tokenA))).body;
    const files = wiki.gallery.map((g) => path.join(ctx.uploadDir, g.file));
    expect(files).toHaveLength(12);
    expect(files.every((f) => existsSync(f))).toBe(true);
    await api().delete(`/api/pets/${petId}`).set(auth(tokenA)).expect(204);
    expect(files.some((f) => existsSync(f))).toBe(false);
    await api().get('/api/public/wiki/mochi').expect(404);
    const { rowCount } = await ctx.pool.query('SELECT 1 FROM pet_wikis WHERE pet_id = $1', [petId]);
    expect(rowCount).toBe(0);
  });
});
