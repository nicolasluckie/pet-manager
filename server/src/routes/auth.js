import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { ApiError } from '../lib/errors.js';
import { parse } from '../lib/validate.js';
import { checkPasswordPolicy, hashPassword, verifyPassword, dummyHash } from '../lib/password.js';
import { signToken, isAnonymousModeActive } from '../middleware/auth.js';
import { withTransaction } from '../db/pool.js';
import { createHousehold } from '../services/households.js';

const email = z.string().trim().toLowerCase().email().max(254);
const registerSchema = z.object({
  email,
  password: z.string(),
  display_name: z.string().trim().min(1).max(100),
  locale: z.enum(['en', 'de']).optional(),
  // Name of the new household (setup / registration without invite).
  household_name: z.string().trim().min(1).max(100).optional(),
  // Joins an existing household instead of creating a new one.
  invite_code: z.string().trim().min(1).max(100).optional(),
});
const loginSchema = z.object({ email, password: z.string().min(1).max(1000) });
const profileSchema = z.object({
  display_name: z.string().trim().min(1).max(100).optional(),
  locale: z.enum(['en', 'de']).optional(),
});
const passwordSchema = z.object({
  current_password: z.string().min(1).max(1000),
  new_password: z.string(),
});

const publicUser = ({ id, email, display_name, role, locale, household_id }) => ({
  id,
  email,
  display_name,
  role,
  locale,
  household_id,
});

export function authRouter({ pool, config, settings, auth }) {
  const router = Router();

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.authRateLimit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    handler: (_req, _res, next) =>
      next(new ApiError(429, 'RATE_LIMITED', 'Too many attempts, try again later')),
  });

  async function userCount() {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
    return rows[0].n;
  }

  async function registrationOpen() {
    return (await userCount()) === 0 || (await settings.get('allowRegistration')) === true;
  }

  // Public: tells the client which screens to show (setup, login, register).
  router.get('/status', async (_req, res) => {
    res.json({
      setupRequired: (await userCount()) === 0,
      registrationOpen: await registrationOpen(),
      anonymousMode: await isAnonymousModeActive(config, settings),
      anonymousModeAllowed: config.allowAnonymousMode,
      siteIcon: await settings.get('siteIcon'),
    });
  });

  router.post('/register', limiter, async (req, res) => {
    const data = parse(registerSchema, req.body);
    const policyError = checkPasswordPolicy(data.password, { email: data.email });
    if (policyError)
      throw new ApiError(400, policyError, 'Password does not meet the requirements');
    if (!data.invite_code && !(await registrationOpen())) {
      throw new ApiError(403, 'REGISTRATION_CLOSED', 'Registration is disabled');
    }

    const hash = await hashPassword(data.password);
    const user = await withTransaction(pool, async (client) => {
      // Serialize registrations so only one account can become the first admin.
      await client.query('LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE');
      const { rows: counted } = await client.query('SELECT count(*)::int AS n FROM users');
      const count = counted[0].n;
      let householdId;
      if (count === 0) {
        // First run: adopt a household that already exists (e.g. demo data
        // loaded before setup), otherwise create one.
        const { rows } = await client.query('SELECT id FROM households ORDER BY id LIMIT 1');
        householdId = rows[0]?.id ?? (await createHousehold(client, 'Household')).id;
        if (data.household_name) {
          await client.query('UPDATE households SET name = $2 WHERE id = $1', [
            householdId,
            data.household_name,
          ]);
        }
      } else if (data.invite_code) {
        // A valid invite works even when open registration is disabled.
        const { rows } = await client.query('SELECT id FROM households WHERE invite_code = $1', [
          data.invite_code,
        ]);
        if (!rows[0]) throw new ApiError(400, 'INVITE_INVALID', 'Invite code is invalid');
        householdId = rows[0].id;
      } else {
        if ((await settings.get('allowRegistration')) !== true) {
          throw new ApiError(403, 'REGISTRATION_CLOSED', 'Registration is disabled');
        }
        householdId = (await createHousehold(client, data.household_name ?? 'Household')).id;
      }
      // The very first account becomes the administrator.
      const role = count === 0 ? 'admin' : 'user';
      try {
        const { rows } = await client.query(
          `INSERT INTO users (email, display_name, password_hash, role, locale, household_id)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [
            data.email,
            data.display_name,
            hash,
            role,
            data.locale ?? config.defaultLocale,
            householdId,
          ],
        );
        return rows[0];
      } catch (err) {
        if (err.code === '23505')
          throw new ApiError(409, 'EMAIL_TAKEN', 'E-mail already registered');
        throw err;
      }
    });
    res.status(201).json({ token: signToken(config, user), user: publicUser(user) });
  });

  router.post('/login', limiter, async (req, res) => {
    const data = parse(loginSchema, req.body);
    const { rows } = await pool.query('SELECT * FROM users WHERE lower(email) = $1', [data.email]);
    const user = rows[0];
    const ok = await verifyPassword(data.password, user?.password_hash ?? (await dummyHash()));
    if (!user || !ok)
      throw new ApiError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid e-mail or password');
    res.json({ token: signToken(config, user), user: publicUser(user) });
  });

  router.get('/me', auth.authenticate({ allowAnonymous: true }), (req, res) => {
    res.json(req.user.anonymous ? { anonymous: true, role: 'user' } : publicUser(req.user));
  });

  router.patch('/me', auth.authenticate(), async (req, res) => {
    const data = parse(profileSchema, req.body);
    const { rows } = await pool.query(
      `UPDATE users SET display_name = COALESCE($2, display_name), locale = COALESCE($3, locale), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.user.id, data.display_name ?? null, data.locale ?? null],
    );
    res.json(publicUser(rows[0]));
  });

  router.post('/password', limiter, auth.authenticate(), async (req, res) => {
    const data = parse(passwordSchema, req.body);
    const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [
      req.user.id,
    ]);
    if (!(await verifyPassword(data.current_password, rows[0].password_hash))) {
      throw new ApiError(400, 'AUTH_WRONG_PASSWORD', 'Current password is wrong');
    }
    const policyError = checkPasswordPolicy(data.new_password, { email: req.user.email });
    if (policyError)
      throw new ApiError(400, policyError, 'Password does not meet the requirements');
    // Truncate to whole seconds: JWT "iat" has second precision.
    const { rows: updated } = await pool.query(
      `UPDATE users SET password_hash = $2, password_changed_at = date_trunc('second', now()), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.user.id, await hashPassword(data.new_password)],
    );
    // Other sessions are logged out; this one gets a fresh token.
    res.json({ token: signToken(config, updated[0]) });
  });

  return router;
}
