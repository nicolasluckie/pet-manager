import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import { ApiError } from '../lib/errors.js';
import { parse, idParam } from '../lib/validate.js';
import { detectImageType, removeUpload } from '../lib/image.js';
import { petSchema } from './schemas.js';
import { wikiFiles } from './wiki.js';

export function petsRouter({ pool, config }) {
  const router = Router();
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 0 },
  });

  router.get('/', async (req, res) => {
    const archived = req.query.archived === 'true';
    const { rows } = await pool.query(
      `SELECT p.*,
         (SELECT weight_kg FROM health_entries h
           WHERE h.pet_id = p.id AND h.weight_kg IS NOT NULL ORDER BY date DESC, id DESC LIMIT 1) AS last_weight_kg,
         (SELECT count(*)::int FROM illnesses i WHERE i.pet_id = p.id AND i.status <> 'resolved') AS open_illnesses
       FROM pets p WHERE p.household_id = $1 AND p.archived = $2 ORDER BY lower(p.name)`,
      [req.user.household_id, archived],
    );
    res.json(rows);
  });

  router.post('/', async (req, res) => {
    const data = parse(petSchema, req.body);
    const cols = Object.keys(data);
    const { rows } = await pool.query(
      `INSERT INTO pets (household_id${cols.map((c) => `, ${c}`).join('')})
       VALUES ($1${cols.map((_, i) => `, $${i + 2}`).join('')}) RETURNING *`,
      [req.user.household_id, ...cols.map((c) => data[c])],
    );
    res.status(201).json(rows[0]);
  });

  router.get('/:id', async (req, res) => {
    res.json(await findPet(req, parse(idParam, req.params.id)));
  });

  router.patch('/:id', async (req, res) => {
    const id = parse(idParam, req.params.id);
    const data = parse(petSchema.partial(), req.body);
    const cols = Object.keys(data);
    if (!cols.length) return res.json(await findPet(req, id));
    const { rows } = await pool.query(
      `UPDATE pets SET ${cols.map((c, i) => `${c} = $${i + 3}`).join(', ')}, updated_at = now()
       WHERE id = $1 AND household_id = $2 RETURNING *`,
      [id, req.user.household_id, ...cols.map((c) => data[c])],
    );
    if (!rows[0]) throw new ApiError(404, 'PET_NOT_FOUND', 'pet not found');
    res.json(rows[0]);
  });

  router.delete('/:id', async (req, res) => {
    const id = parse(idParam, req.params.id);
    const gallery = await wikiFiles(pool, id);
    const { rows } = await pool.query(
      'DELETE FROM pets WHERE id = $1 AND household_id = $2 RETURNING photo',
      [id, req.user.household_id],
    );
    if (!rows[0]) throw new ApiError(404, 'PET_NOT_FOUND', 'pet not found');
    await removePhoto(rows[0].photo);
    await Promise.all(gallery.map(removePhoto));
    res.status(204).end();
  });

  router.post(
    '/:id/photo',
    (req, res, next) => {
      upload.single('photo')(req, res, (err) => {
        if (err?.code === 'LIMIT_FILE_SIZE') {
          return next(
            new ApiError(413, 'UPLOAD_TOO_LARGE', 'File too large', {
              maxBytes: config.maxUploadBytes,
            }),
          );
        }
        if (err) return next(new ApiError(400, 'UPLOAD_INVALID', err.message));
        next();
      });
    },
    async (req, res) => {
      const id = parse(idParam, req.params.id);
      const pet = await findPet(req, id);
      if (!req.file) throw new ApiError(400, 'UPLOAD_MISSING', 'No file uploaded');
      const kind = detectImageType(req.file.buffer);
      if (!kind)
        throw new ApiError(
          415,
          'UPLOAD_UNSUPPORTED_TYPE',
          'Only JPEG, PNG, WebP and GIF images are allowed',
        );
      // Random, unguessable file name; the original name is never used on disk.
      const filename = `${randomUUID()}.${kind.ext}`;
      await writeFile(path.join(config.uploadDir, filename), req.file.buffer, { mode: 0o640 });
      const { rows } = await pool.query(
        'UPDATE pets SET photo = $2, updated_at = now() WHERE id = $1 RETURNING *',
        [id, filename],
      );
      await removePhoto(pet.photo);
      res.json(rows[0]);
    },
  );

  router.delete('/:id/photo', async (req, res) => {
    const id = parse(idParam, req.params.id);
    const pet = await findPet(req, id);
    const { rows } = await pool.query(
      'UPDATE pets SET photo = NULL, updated_at = now() WHERE id = $1 RETURNING *',
      [id],
    );
    await removePhoto(pet.photo);
    res.json(rows[0]);
  });

  // Pets of other households are reported as "not found".
  async function findPet(req, id) {
    const { rows } = await pool.query('SELECT * FROM pets WHERE id = $1 AND household_id = $2', [
      id,
      req.user.household_id,
    ]);
    if (!rows[0]) throw new ApiError(404, 'PET_NOT_FOUND', 'pet not found');
    return rows[0];
  }

  const removePhoto = (filename) => removeUpload(config.uploadDir, filename);

  return router;
}
