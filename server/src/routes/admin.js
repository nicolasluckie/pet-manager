import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';
import { parse, idParam } from '../lib/validate.js';
import { removeUpload } from '../lib/image.js';
import { singleImageUpload, storeUploadedImage } from '../lib/upload.js';
import { createHousehold, newInviteCode } from '../services/households.js';
import { householdName } from './household.js';

const settingsSchema = z.object({
  requireLogin: z.boolean().optional(),
  allowRegistration: z.boolean().optional(),
});

const userUpdateSchema = z
  .object({
    role: z.enum(['admin', 'user']).optional(),
    household_id: z.coerce.number().int().positive().optional(),
  })
  .refine((d) => d.role !== undefined || d.household_id !== undefined, 'Nothing to update');

const USER_COLUMNS = `u.id, u.email, u.display_name, u.role, u.locale, u.created_at,
  u.household_id, h.name AS household_name`;

/** Instance administration: access settings, users, households. */
export function adminRouter({ pool, config, settings }) {
  const router = Router();

  async function publicSettings() {
    const { requireLogin, allowRegistration, anonymousHouseholdId, siteIcon } =
      await settings.all();
    return {
      requireLogin,
      allowRegistration,
      anonymousHouseholdId,
      siteIcon,
      anonymousModeAllowed: config.allowAnonymousMode,
    };
  }

  router.get('/settings', async (_req, res) => {
    res.json(await publicSettings());
  });

  router.put('/settings', async (req, res) => {
    const data = parse(settingsSchema, req.body);
    if (data.requireLogin === false) {
      if (!config.allowAnonymousMode) {
        throw new ApiError(
          400,
          'ANONYMOUS_MODE_NOT_ALLOWED',
          'Set ALLOW_ANONYMOUS_MODE=true on the server first',
        );
      }
      // Anonymous visitors see the household of the admin who opened access.
      data.anonymousHouseholdId = req.user.household_id;
    }
    await settings.set(data);
    res.json(await publicSettings());
  });

  const uploadIcon = singleImageUpload(config);

  router.post('/site-icon', uploadIcon, async (req, res) => {
    const icon = await storeUploadedImage(config, req.file);
    const previous = await settings.get('siteIcon');
    await settings.set({ siteIcon: icon });
    await removeUpload(config.uploadDir, previous);
    res.status(201).json(await publicSettings());
  });

  router.delete('/site-icon', async (_req, res) => {
    const previous = await settings.get('siteIcon');
    await settings.set({ siteIcon: null });
    await removeUpload(config.uploadDir, previous);
    res.json(await publicSettings());
  });

  router.get('/users', async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS} FROM users u JOIN households h ON h.id = u.household_id
       ORDER BY u.created_at`,
    );
    res.json(rows);
  });

  async function findUser(id) {
    const { rows } = await pool.query(
      `SELECT ${USER_COLUMNS} FROM users u JOIN households h ON h.id = u.household_id
       WHERE u.id = $1`,
      [id],
    );
    if (!rows[0]) throw new ApiError(404, 'USER_NOT_FOUND', 'user not found');
    return rows[0];
  }

  router.patch('/users/:id', async (req, res) => {
    const id = parse(idParam, req.params.id);
    const { role, household_id } = parse(userUpdateSchema, req.body);
    if (id === req.user.id && role !== undefined && role !== 'admin')
      throw new ApiError(400, 'CANNOT_DEMOTE_SELF', 'You cannot remove your own admin rights');
    await findUser(id);
    if (household_id !== undefined) {
      const { rowCount } = await pool.query('SELECT 1 FROM households WHERE id = $1', [
        household_id,
      ]);
      if (!rowCount) throw new ApiError(404, 'HOUSEHOLD_NOT_FOUND', 'household not found');
    }
    await pool.query(
      `UPDATE users SET role = COALESCE($2, role), household_id = COALESCE($3, household_id),
         updated_at = now() WHERE id = $1`,
      [id, role ?? null, household_id ?? null],
    );
    res.json(await findUser(id));
  });

  router.delete('/users/:id', async (req, res) => {
    const id = parse(idParam, req.params.id);
    if (id === req.user.id)
      throw new ApiError(400, 'CANNOT_DELETE_SELF', 'You cannot delete your own account');
    const { rowCount } = await pool.query('DELETE FROM users WHERE id = $1', [id]);
    if (!rowCount) throw new ApiError(404, 'USER_NOT_FOUND', 'user not found');
    res.status(204).end();
  });

  const householdColumns = `h.id, h.name, h.invite_code, h.created_at,
    (SELECT count(*)::int FROM users u WHERE u.household_id = h.id) AS member_count,
    (SELECT count(*)::int FROM pets p WHERE p.household_id = h.id) AS pet_count`;

  async function findHousehold(id) {
    const { rows } = await pool.query(
      `SELECT ${householdColumns} FROM households h WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw new ApiError(404, 'HOUSEHOLD_NOT_FOUND', 'household not found');
    return rows[0];
  }

  router.get('/households', async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT ${householdColumns} FROM households h ORDER BY lower(h.name), h.id`,
    );
    res.json(rows);
  });

  // New, empty household with an invite code, so a new family can join it.
  router.post('/households', async (req, res) => {
    const { name } = parse(z.object({ name: householdName }), req.body);
    const household = await createHousehold(pool, name);
    await pool.query('UPDATE households SET invite_code = $2 WHERE id = $1', [
      household.id,
      newInviteCode(),
    ]);
    res.status(201).json(await findHousehold(household.id));
  });

  router.patch('/households/:id', async (req, res) => {
    const id = parse(idParam, req.params.id);
    const { name } = parse(z.object({ name: householdName }), req.body);
    await findHousehold(id);
    await pool.query('UPDATE households SET name = $2, updated_at = now() WHERE id = $1', [
      id,
      name,
    ]);
    res.json(await findHousehold(id));
  });

  // Deletes a household without members, including all of its pets and data.
  router.delete('/households/:id', async (req, res) => {
    const id = parse(idParam, req.params.id);
    const household = await findHousehold(id);
    if (household.member_count > 0) {
      throw new ApiError(409, 'HOUSEHOLD_NOT_EMPTY', 'Move or delete its members first');
    }
    const { rows: photos } = await pool.query(
      'SELECT photo FROM pets WHERE household_id = $1 AND photo IS NOT NULL',
      [id],
    );
    try {
      await pool.query('DELETE FROM households WHERE id = $1', [id]);
    } catch (err) {
      // A member was added concurrently (users reference households RESTRICT).
      if (err.code === '23503')
        throw new ApiError(409, 'HOUSEHOLD_NOT_EMPTY', 'Move or delete its members first');
      throw err;
    }
    if ((await settings.get('anonymousHouseholdId')) === id) {
      await settings.set({ anonymousHouseholdId: null });
    }
    for (const { photo } of photos) await removeUpload(config.uploadDir, photo);
    res.status(204).end();
  });

  return router;
}
