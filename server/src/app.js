import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import mongoose from 'mongoose';
import swaggerUi from 'swagger-ui-express';
import { randomUUID } from 'node:crypto';
import { openapi } from '../docs/openapi.js';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { errorHandler, notFound } from './middleware/error.js';
import { ApiError } from './utils/ApiError.js';

/** Rejects Mongo operator injection ($where, $ne, ...) hidden in query strings, bodies or params. */
function rejectOperators(req, _res, next) {
  const bad = (v) => {
    if (Array.isArray(v)) return v.some(bad);
    if (v && typeof v === 'object') return Object.entries(v).some(([k, val]) => k.startsWith('$') || k.includes('.') || bad(val));
    return false;
  };
  if ([req.query, req.body, req.params].some(bad)) return next(ApiError.badRequest('Request contains disallowed characters in field names'));
  next();
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    req.id = req.headers['x-request-id'] || randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  });
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(compression());
  app.use(
    cors({
      origin(origin, cb) {
        // Flutter Web's development server uses a changing local port, unlike
        // the Vite admin app's fixed port. Keep this exception development-only.
        let isLocalDevOrigin = false;
        if (!env.isProd && origin) {
          try {
            const url = new URL(origin);
            isLocalDevOrigin = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
          } catch {
            isLocalDevOrigin = false;
          }
        }
        if (!origin || env.corsOrigins.includes(origin) || isLocalDevOrigin) return cb(null, true);
        cb(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: true,
      exposedHeaders: ['Content-Disposition', 'X-Request-Id'],
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  if (!env.isTest) {
    morgan.token('id', (req) => req.id);
    app.use(morgan(env.isProd ? ':id :remote-addr :method :url :status :res[content-length] - :response-time ms' : 'dev'));
  }
  app.use(rejectOperators);

  // Readiness: 200 only when MongoDB is connected (use for k8s/Docker health checks)
  app.get('/api/ready', (_req, res) => {
    const up = mongoose.connection.readyState === 1;
    res.status(up ? 200 : 503).json({ success: up, status: up ? 'ready' : 'database unavailable' });
  });
  if (!env.isProd || env.enableDocs) {
    app.get('/api/openapi.json', (_req, res) => res.json(openapi));
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'HR Admin Panel API' }));
  }

  app.use('/api/v1', routes);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
