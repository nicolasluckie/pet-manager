import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestContext, PASSWORD } from './helpers.js';

let ctx;
let token;
let petId;

beforeAll(async () => {
  ctx = await createTestContext();
  const res = await request(ctx.app)
    .post('/api/auth/register')
    .send({ email: 'w@example.com', password: PASSWORD, display_name: 'W' });
  token = res.body.token;
  const pet = await request(ctx.app)
    .post('/api/pets')
    .set(auth())
    .send({ name: 'Axel', species: 'cat', breed: 'Shorthair', microchip: '985112345678901' });
  petId = pet.body.id;
});
afterAll(async () => {
  await ctx.pool.end();
});

const api = () => request(ctx.app);
const auth = () => ({ Authorization: `Bearer ${token}` });
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32),
]);

describe('pet wiki', () => {
  it('is unpublished by default and public access 404s', async () => {
    const res = await api().get(`/api/pets/${petId}/wiki`).set(auth());
    expect(res.body).toMatchObject({ slug: 'axel', published: false });
    expect(res.body.content.personality.traits).toEqual([]);
    expect(res.body.content.favourites.toys).toEqual([]);
    expect(res.body.content.biography).toEqual({ content: '', earlyLife: '' });
    await api().get('/api/public/wiki/axel').expect(404);
  });

  it('publishes only the fields that are switched on, never the chip number', async () => {
    await api()
      .put(`/api/pets/${petId}/wiki`)
      .set(auth())
      .send({
        slug: 'axel',
        published: true,
        content: { subtitle: 'Domestic cat', biography: { content: '**Axel** is a cat.' } },
        show: { breed: true, microchipped: true, biography: true },
      })
      .expect(200);
    const res = await api().get('/api/public/wiki/axel').expect(200);
    expect(res.body.name).toBe('Axel');
    expect(res.body.facts).toEqual({ breed: 'Shorthair' });
    expect(res.body.sections.biography.content).toBe('**Axel** is a cat.');
    expect(res.body.sections.health).toEqual({ microchipped: true });
    expect(JSON.stringify(res.body)).not.toContain('985112345678901');
    expect(res.body.sections.personality).toBeUndefined();
  });

  it('rejects invalid and duplicate slugs', async () => {
    await api()
      .put(`/api/pets/${petId}/wiki`)
      .set(auth())
      .send({ slug: 'Bad Slug!', published: false, content: {}, show: {} })
      .expect(400);
    const other = await api().post('/api/pets').set(auth()).send({ name: 'Other' });
    const res = await api()
      .put(`/api/pets/${other.body.id}/wiki`)
      .set(auth())
      .send({ slug: 'axel', published: false, content: {}, show: {} });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLUG_TAKEN');
  });

  it('manages gallery images and hides unpublished pages again', async () => {
    const up = await api()
      .post(`/api/pets/${petId}/wiki/gallery`)
      .set(auth())
      .attach('photo', PNG, 'x.png')
      .expect(201);
    const { file } = up.body.gallery[0];
    await api()
      .patch(`/api/pets/${petId}/wiki/gallery/${file}`)
      .set(auth())
      .send({ caption: 'Nap time' })
      .expect(200);
    const wiki = (await api().get(`/api/pets/${petId}/wiki`).set(auth())).body;
    await api()
      .put(`/api/pets/${petId}/wiki`)
      .set(auth())
      .send({ ...wiki, show: { ...wiki.show, gallery: true } })
      .expect(200);
    const pub = await api().get('/api/public/wiki/axel').expect(200);
    expect(pub.body.sections.gallery).toEqual([{ file, caption: 'Nap time' }]);
    await api().delete(`/api/pets/${petId}/wiki/gallery/${file}`).set(auth()).expect(200);
    await api()
      .put(`/api/pets/${petId}/wiki`)
      .set(auth())
      .send({ ...wiki, published: false })
      .expect(200);
    await api().get('/api/public/wiki/axel').expect(404);
  });
});
