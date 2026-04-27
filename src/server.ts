import express, { type Express } from 'express';
import path from 'node:path';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import type { PrismaClient } from '@prisma/client';
import { env, isProd } from '@/config/env.js';
import { logger } from '@/lib/logger.js';
import { requestContext } from '@/middleware/requestContext.js';
import { globalIpLimit } from '@/middleware/rateLimit.js';
import { globalErrorHandler, notFoundHandler } from '@/middleware/errorHandler.js';
import { createAuthRouter } from '@/modules/auth/auth.routes.js';
import { createHealthRouter } from '@/modules/health/health.routes.js';
import { createUsersRouter } from '@/modules/users/users.routes.js';
import { createCitiesRouter } from '@/modules/cities/cities.routes.js';
import { createDriversRouter } from '@/modules/drivers/drivers.routes.js';
import { createAdminRouter } from '@/modules/admin/admin.routes.js';
import { createRoutesRouter, createTripsRouter } from '@/modules/trips/trips.routes.js';
import { createBookingsRouter } from '@/modules/bookings/bookings.routes.js';
import { createChatsRouter, createMessagesRouter } from '@/modules/chat/chat.routes.js';
import { createRatingsRouter } from '@/modules/ratings/ratings.routes.js';
import { createNotificationsRouter } from '@/modules/notifications/notifications.routes.js';
import { createComplaintsRouter } from '@/modules/complaints/complaints.routes.js';
import { createLoyaltyRouter } from '@/modules/loyalty/loyalty.routes.js';
import { createPassengerRequestsRouter } from '@/modules/passenger-requests/passenger-requests.routes.js';
import { NoopNotifier, type Notifier } from '@/lib/notifier.js';
import type { TelegramSender } from '@/modules/auth/auth.otp.js';
import { openapiDocument } from '@/openapi.js';

/**
 * Build the Express app. Returns a vanilla instance with no side effects —
 * each test can spin up its own app without port binding (Supertest attaches
 * directly to the handler).
 */
export function createApp(
  prisma: PrismaClient,
  notifier: Notifier = new NoopNotifier(),
  bot: TelegramSender | null = null,
): Express {
  const app = express();

  // Behind Nginx — trust X-Forwarded-For so rate-limit and logs see the real IP.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({ contentSecurityPolicy: isProd ? undefined : false }));
  const allowedOrigins = isProd
    ? (env.ALLOWED_ORIGINS ?? '').split(',').map((o) => o.trim()).filter(Boolean)
    : ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001', 'https://legacy-nurse-black-try.trycloudflare.com'];

  // Matches any localhost or 127.0.0.1 origin on any port — covers Flutter web
  // which picks a random port (`flutter run -d chrome`).
  const localhostRe = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

  app.use(
    cors({
      origin: (origin, cb) => {
        // Same-origin / server-to-server (no Origin header) — always allow.
        if (!origin) return cb(null, true);
        if (isProd) {
          return allowedOrigins.includes(origin)
            ? cb(null, true)
            : cb(new Error(`CORS: origin ${origin} not allowed`));
        }
        // Dev: allow any localhost port so Flutter web, Vite, Swagger UI all work.
        if (localhostRe.test(origin) || allowedOrigins.includes(origin)) {
          return cb(null, true);
        }
        cb(new Error(`CORS: origin ${origin} not allowed`));
      },
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));
  app.use(requestContext);
  app.use(globalIpLimit);

  // Health goes outside /v1 so load balancers can probe it without versioning.
  app.use(createHealthRouter(prisma));

  // Versioned API surface.
  const v1 = express.Router();
  v1.use('/auth', createAuthRouter(prisma, notifier, bot));
  v1.use('/users', createUsersRouter(prisma, notifier));
  v1.use('/cities', createCitiesRouter(prisma));
  v1.use('/drivers', createDriversRouter(prisma));
  v1.use('/trips', createTripsRouter(prisma, notifier));
  v1.use('/routes', createRoutesRouter(prisma));
  v1.use('/bookings', createBookingsRouter(prisma, notifier));
  v1.use('/chats', createChatsRouter(prisma, notifier));
  v1.use('/messages', createMessagesRouter(prisma, notifier));
  v1.use('/ratings', createRatingsRouter(prisma, notifier));
  v1.use('/notifications', createNotificationsRouter(prisma));
  v1.use('/complaints', createComplaintsRouter(prisma, notifier));
  v1.use('/loyalty', createLoyaltyRouter(prisma, notifier));
  v1.use('/passenger-requests', createPassengerRequestsRouter(prisma, notifier));
  v1.use('/admin', createAdminRouter(prisma, notifier));
  app.use('/v1', v1);

  // Swagger — dev/staging only, gated by ENABLE_SWAGGER.
  if (env.ENABLE_SWAGGER && !isProd) {
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiDocument));
    app.get('/openapi.json', (_req, res) => res.json(openapiDocument));
    logger.info('Swagger enabled at /docs');
  }

  // Serve uploaded files (avatars, driver docs) from FILES_DIR.
  // e.g. GET /avatars/2026/04/xxx.jpg → ./var/files/avatars/2026/04/xxx.jpg
  // Override Helmet's default CORP: same-origin so the web frontend (different port
  // in dev, different subdomain in prod) can load images with plain <img src>.
  app.use(
    express.static(path.resolve(env.FILES_DIR), {
      setHeaders: (res) => {
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      },
    }),
  );

  // 404 + global error handler must be registered last.
  app.use(notFoundHandler);
  app.use(globalErrorHandler);

  return app;
}
