import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { parse, idParam, requiredText } from '../lib/validate.js';
import { removeUpload } from '../lib/image.js';
import { singleImageUpload, storeUploadedImage } from '../lib/upload.js';

// Privacy by design: nothing is public unless its `show` flag is true. The
// microchip number, notes, vet data etc. are never exposed; only the yes/no flag.
export const SHOW_KEYS = [
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
];
export const MAX_GALLERY = 12;

const text = (max = 2000) => z.string().trim().max(max).default('');
const list = z.array(z.string().trim().min(1).max(100)).max(30).default([]);
const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use letters, digits and single hyphens')
  .min(3)
  .max(40);

export const wikiContentSchema = z.object({
  subtitle: text(200),
  imageCaption: text(200),
  infobox: z
    .array(z.object({ label: requiredText(60), value: requiredText(200) }))
    .max(20)
    .default([]),
  biography: z.object({ content: text(), earlyLife: text() }).prefault({}),
  personality: z.object({ content: text(), traits: list }).prefault({}),
  health: z.object({ content: text(), allergies: text(500), dietaryNotes: text(500) }).prefault({}),
  favourites: z
    .object({ toys: list, foods: list, activities: list, sleepingSpots: list })
    .prefault({}),
  homeArea: z.object({ city: text(100), state: text(100), notes: text(1000) }).prefault({}),
  ownerName: text(100),
  contactNote: text(300),
  // Page (tab) title of the public page: the pet's name, or the app's default title.
  titleFromName: z.boolean().default(true),
});

const showSchema = z.object(Object.fromEntries(SHOW_KEYS.map((k) => [k, z.boolean().optional()])));

export const wikiSchema = z.object({
  slug,
  published: z.boolean(),
  content: wikiContentSchema,
  show: showSchema,
});

const defaultShow = () => Object.fromEntries(SHOW_KEYS.map((k) => [k, false]));
const normalizeShow = (show = {}) => ({ ...defaultShow(), ...show });
const emptyContent = () => wikiContentSchema.parse({});

function slugify(pet) {
  const base = String(pet.name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '');
  return base.length >= 3 ? base : `pet-${pet.id}`;
}

const toWiki = (row, pet) => ({
  pet_id: pet.id,
  slug: row?.slug ?? slugify(pet),
  published: row?.published ?? false,
  content: { ...emptyContent(), ...(row?.content ?? {}) },
  show: normalizeShow(row?.show),
  gallery: row?.gallery ?? [],
  icon: row?.icon ?? null,
});

/** Builds the public article payload for a pet. Only enabled fields are included. */
export async function buildArticle(pool, pet, row) {
  const wiki = toWiki(row, pet);
  const { show, content } = wiki;
  const has = (...values) => values.some((v) => (Array.isArray(v) ? v.length : v));
  const article = {
    name: pet.name,
    subtitle: content.subtitle,
    facts: {},
    infobox: content.infobox,
    image: null,
    icon: wiki.icon,
    titleFromName: content.titleFromName,
    sections: {},
  };
  if (show.species) article.facts.species = pet.species;
  if (show.breed && pet.breed) article.facts.breed = pet.breed;
  if (show.sex && pet.sex) article.facts.sex = pet.sex;
  if (show.color && pet.color) article.facts.color = pet.color;
  if (show.born && pet.birth_date) article.facts.born = pet.birth_date;
  if (show.photo && pet.photo) article.image = { file: pet.photo, caption: content.imageCaption };

  if (show.biography && has(content.biography.content, content.biography.earlyLife))
    article.sections.biography = content.biography;
  if (show.personality && has(content.personality.content, content.personality.traits))
    article.sections.personality = content.personality;

  const health = {};
  if (show.health && content.health.content) health.content = content.health.content;
  if (show.neutered) health.neutered = pet.neutered;
  if (show.microchipped) health.microchipped = Boolean(pet.microchip);
  if (show.allergies && content.health.allergies) health.allergies = content.health.allergies;
  if (show.dietaryNotes && content.health.dietaryNotes)
    health.dietaryNotes = content.health.dietaryNotes;
  if (show.vaccinations) {
    const { rows } = await pool.query(
      `SELECT COALESCE(title, 'Vaccination') AS name, date::text AS date FROM health_entries
       WHERE pet_id = $1 AND type = 'vaccination' ORDER BY date DESC, id DESC LIMIT 30`,
      [pet.id],
    );
    if (rows.length) health.vaccinations = rows;
  }
  if (Object.keys(health).length) article.sections.health = health;

  const fav = content.favourites;
  if (show.favourites && has(fav.toys, fav.foods, fav.activities, fav.sleepingSpots))
    article.sections.favourites = fav;
  if (show.gallery && wiki.gallery.length) article.sections.gallery = wiki.gallery;
  const home = content.homeArea;
  if (show.homeArea && has(home.city, home.state, home.notes)) article.sections.homeArea = home;
  if (show.ownerName && content.ownerName)
    article.sections.contact = { ownerName: content.ownerName, note: content.contactNote };
  return article;
}

async function loadWikiRow(pool, petId) {
  const { rows } = await pool.query('SELECT * FROM pet_wikis WHERE pet_id = $1', [petId]);
  return rows[0];
}

/** Public, unauthenticated read access to published wiki pages. */
export function publicWikiRouter({ pool }) {
  const router = Router();
  router.get('/:slug', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT p.*, w.slug AS wiki_slug FROM pet_wikis w JOIN pets p ON p.id = w.pet_id
       WHERE w.slug = $1 AND w.published AND NOT p.archived`,
      [String(req.params.slug).toLowerCase()],
    );
    if (!rows[0]) throw new ApiError(404, 'WIKI_NOT_FOUND', 'wiki not found');
    res.setHeader('Cache-Control', 'no-cache');
    res.json(await buildArticle(pool, rows[0], await loadWikiRow(pool, rows[0].id)));
  });
  return router;
}

/** Wiki configuration of a pet (nested below /pets/:petId/wiki). */
export function petWikiRouter({ pool, config }) {
  const router = Router({ mergeParams: true });
  const uploadOne = singleImageUpload(config);

  async function findPet(req) {
    const id = parse(idParam, req.params.petId);
    const { rows } = await pool.query('SELECT * FROM pets WHERE id = $1 AND household_id = $2', [
      id,
      req.user.household_id,
    ]);
    if (!rows[0]) throw new ApiError(404, 'PET_NOT_FOUND', 'pet not found');
    return rows[0];
  }

  router.get('/', async (req, res) => {
    const pet = await findPet(req);
    res.json(toWiki(await loadWikiRow(pool, pet.id), pet));
  });

  router.get('/preview', async (req, res) => {
    const pet = await findPet(req);
    res.json(await buildArticle(pool, pet, await loadWikiRow(pool, pet.id)));
  });

  router.put('/', async (req, res) => {
    const pet = await findPet(req);
    const data = parse(wikiSchema, req.body);
    try {
      await pool.query(
        `INSERT INTO pet_wikis (pet_id, slug, published, content, show)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (pet_id) DO UPDATE SET slug = $2, published = $3, content = $4, show = $5,
           updated_at = now()`,
        [
          pet.id,
          data.slug,
          data.published,
          JSON.stringify(data.content),
          JSON.stringify(normalizeShow(data.show)),
        ],
      );
    } catch (err) {
      if (err?.code === '23505') throw new ApiError(409, 'SLUG_TAKEN', 'slug already in use');
      throw err;
    }
    res.json(toWiki(await loadWikiRow(pool, pet.id), pet));
  });

  router.post('/gallery', uploadOne, async (req, res) => {
    const pet = await findPet(req);
    const current = (await loadWikiRow(pool, pet.id))?.gallery ?? [];
    if (current.length >= MAX_GALLERY)
      throw new ApiError(400, 'GALLERY_FULL', 'gallery is full', { max: MAX_GALLERY });
    const file = await storeUploadedImage(config, req.file);
    const gallery = [...current, { file, caption: '' }];
    await pool.query(
      `INSERT INTO pet_wikis (pet_id, slug, gallery) VALUES ($1, $2, $3)
       ON CONFLICT (pet_id) DO UPDATE SET gallery = $3, updated_at = now()`,
      [pet.id, await freeSlug(pet), JSON.stringify(gallery)],
    );
    res.status(201).json(toWiki(await loadWikiRow(pool, pet.id), pet));
  });

  router.patch('/gallery/:file', async (req, res) => {
    const pet = await findPet(req);
    const { caption } = parse(z.object({ caption: text(200) }), req.body);
    const row = await loadWikiRow(pool, pet.id);
    const gallery = (row?.gallery ?? []).map((g) =>
      g.file === req.params.file ? { ...g, caption } : g,
    );
    await pool.query('UPDATE pet_wikis SET gallery = $2, updated_at = now() WHERE pet_id = $1', [
      pet.id,
      JSON.stringify(gallery),
    ]);
    res.json(toWiki(await loadWikiRow(pool, pet.id), pet));
  });

  router.delete('/gallery/:file', async (req, res) => {
    const pet = await findPet(req);
    const row = await loadWikiRow(pool, pet.id);
    const entry = row?.gallery?.find((g) => g.file === req.params.file);
    if (!entry) throw new ApiError(404, 'WIKI_IMAGE_NOT_FOUND', 'image not found');
    await pool.query('UPDATE pet_wikis SET gallery = $2, updated_at = now() WHERE pet_id = $1', [
      pet.id,
      JSON.stringify(row.gallery.filter((g) => g.file !== entry.file)),
    ]);
    await removeUpload(config.uploadDir, entry.file);
    res.json(toWiki(await loadWikiRow(pool, pet.id), pet));
  });

  router.post('/icon', uploadOne, async (req, res) => {
    const pet = await findPet(req);
    const icon = await storeUploadedImage(config, req.file);
    const previous = (await loadWikiRow(pool, pet.id))?.icon;
    await pool.query(
      `INSERT INTO pet_wikis (pet_id, slug, icon) VALUES ($1, $2, $3)
       ON CONFLICT (pet_id) DO UPDATE SET icon = $3, updated_at = now()`,
      [pet.id, await freeSlug(pet), icon],
    );
    await removeUpload(config.uploadDir, previous);
    res.status(201).json(toWiki(await loadWikiRow(pool, pet.id), pet));
  });

  router.delete('/icon', async (req, res) => {
    const pet = await findPet(req);
    const row = await loadWikiRow(pool, pet.id);
    await pool.query('UPDATE pet_wikis SET icon = NULL, updated_at = now() WHERE pet_id = $1', [
      pet.id,
    ]);
    await removeUpload(config.uploadDir, row?.icon);
    res.json(toWiki(await loadWikiRow(pool, pet.id), pet));
  });

  // Finds an unused slug for rows created implicitly (e.g. by a gallery upload).
  async function freeSlug(pet) {
    const base = slugify(pet);
    for (let i = 0; i < 20; i++) {
      const candidate = i ? `${base}-${randomUUID().slice(0, 4)}` : base;
      const { rowCount } = await pool.query('SELECT 1 FROM pet_wikis WHERE slug = $1', [candidate]);
      if (!rowCount) return candidate;
    }
    return `${base}-${randomUUID().slice(0, 8)}`;
  }

  return router;
}

/** Uploaded file names of a pet's wiki (gallery and icon), to clean up when the pet is deleted. */
export async function wikiFiles(pool, petId) {
  const row = await loadWikiRow(pool, petId);
  return [...(row?.gallery ?? []).map((g) => g.file), ...(row?.icon ? [row.icon] : [])];
}
