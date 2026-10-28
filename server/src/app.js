import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'node:path';
import rateLimit from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { ApiError } from './lib/errors.js';
import { createAuth } from './middleware/auth.js';
import { createSettingsStore } from './services/settings.js';
import { authRouter } from './routes/auth.js';
import { petsRouter } from './routes/pets.js';
import { petResourceRouter } from './lib/crud.js';
import { medicationsRouter } from './routes/medications.js';
import { illnessesRouter } from './routes/illnesses.js';
import { adminRouter } from './routes/admin.js';
import { householdRouter } from './routes/household.js';
import { catalogRouter } from './routes/catalog.js';
import { petWikiRouter, publicWikiRouter } from './routes/wiki.js';
import { dashboardRouter } from './routes/dashboard.js';
import {
  healthSchema,
  appointmentSchema,
  feedingSchema,
  preventionSchema,
} from './routes/schemas.js';

export function createApp({ config, pool, settings = createSettingsStore(pool), log = console }) {
  const app = express();
  const auth = createAuth({ config, pool, settings });
  const deps = { config, pool, settings, auth };

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // MUI/emotion inject <style> tags at runtime.
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          // blob: is used for the PDF preview.
          frameSrc: ["'self'", 'blob:'],
          objectSrc: ["'none'"],
          workerSrc: ["'self'"],
          connectSrc: ["'self'"],
          // No inline scripts: the theme bootstrap is a separate file (/theme-init.js).
          scriptSrc: ["'self'"],
          upgradeInsecureRequests: config.isProduction ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  if (config.clientUrls.length) {
    app.use('/api', cors({ origin: config.clientUrls, credentials: false }));
  }
  app.use(express.json({ limit: '1mb' }));

  // Generous per-IP limit for all API routes; login/registration have a much
  // stricter limiter of their own (routes/auth.js).
  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: config.apiRateLimit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      handler: (_req, _res, next) =>
        next(new ApiError(429, 'RATE_LIMITED', 'Too many requests, try again later')),
    }),
  );

  // Liveness/readiness probe for Docker and reverse proxies.
  app.get('/api/healthz', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter(deps));
  // Published pet wiki pages are public (NFC/QR code for finders).
  app.use('/api/public/wiki', publicWikiRouter(deps));

  // Everything below requires a login unless anonymous mode is active.
  const data = express.Router();
  data.use(auth.authenticate({ allowAnonymous: true }));
  data.use('/dashboard', dashboardRouter(deps));
  data.use('/catalog', catalogRouter(deps));
  data.use('/pets', petsRouter(deps));
  data.use(
    '/pets/:petId/health',
    petResourceRouter({
      pool,
      table: 'health_entries',
      schema: healthSchema,
      orderBy: 'date DESC, id DESC',
      code: 'HEALTH_ENTRY',
    }),
  );
  data.use('/pets/:petId/medications', medicationsRouter(deps));
  data.use(
    '/pets/:petId/appointments',
    petResourceRouter({
      pool,
      table: 'appointments',
      schema: appointmentSchema,
      orderBy: 'done, starts_at',
      code: 'APPOINTMENT',
    }),
  );
  data.use(
    '/pets/:petId/feeding',
    petResourceRouter({
      pool,
      table: 'feeding_plans',
      schema: feedingSchema,
      orderBy: 'id',
      code: 'FEEDING_PLAN',
    }),
  );
  data.use(
    '/pets/:petId/prevention',
    petResourceRouter({
      pool,
      table: 'prevention_items',
      schema: preventionSchema,
      orderBy: 'type, id',
      code: 'PREVENTION_ITEM',
    }),
  );
  data.use('/pets/:petId/illnesses', illnessesRouter(deps));
  data.use('/pets/:petId/wiki', petWikiRouter(deps));
  app.use('/api', data);

  // The own household (members, invites, notifications) needs a real login.
  app.use('/api/household', auth.authenticate(), auth.requireAccount, householdRouter(deps));
  // The admin area always needs a real (non-anonymous) admin login.
  app.use('/api/admin', auth.authenticate(), auth.requireAdmin, adminRouter(deps));

  app.use('/api', (_req, _res, next) =>
    next(new ApiError(404, 'NOT_FOUND', 'Unknown API endpoint')),
  );

  // Pet photos: random UUID file names; nosniff and a strict CSP prevent any
  // uploaded file from being interpreted as HTML/script.
  app.use(
    '/uploads',
    express.static(config.uploadDir, {
      fallthrough: false,
      index: false,
      dotfiles: 'deny',
      maxAge: '7d',
      setHeaders: (res) => res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox"),
    }),
  );

  if (config.staticDir && existsSync(config.staticDir)) {
    app.use(express.static(config.staticDir, { index: false, maxAge: '1h' }));
    // SPA fallback
    app.get(/^(?!\/api\/|\/uploads\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.staticDir, 'index.html'));
    });
  }

  app.use((err, req, res, _next) => {
    if (err instanceof ApiError) {
      return res
        .status(err.status)
        .json({ error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err?.type === 'entity.parse.failed') {
      return res
        .status(400)
        .json({ error: { code: 'INVALID_JSON', message: 'Malformed JSON body' } });
    }
    if (err?.type === 'entity.too.large') {
      return res
        .status(413)
        .json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' } });
    }
    if (err?.status === 404 && req.path.startsWith('/uploads')) {
      return res.status(404).end();
    }
    // Foreign key violation, e.g. catalog_id that does not exist
    if (err?.code === '23503') {
      return res
        .status(400)
        .json({ error: { code: 'INVALID_REFERENCE', message: 'Referenced item does not exist' } });
    }
    if (err?.code === '23514') {
      return res
        .status(400)
        .json({ error: { code: 'VALIDATION_FAILED', message: 'Value violates a constraint' } });
    }
    log.error?.(err);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  return app;
}
