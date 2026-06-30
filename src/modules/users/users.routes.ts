import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { createUsersService } from './users.service.js';
import { RatingsQuery, UpdateMeBody, UserIdParam } from './users.schemas.js';
import { validate } from '@/middleware/validate.js';
import { asyncHandler } from '@/middleware/errorHandler.js';
import { requireAuth } from '@/middleware/auth.js';
import { sendOtpDailyLimit, sendOtpMinuteLimit } from '@/middleware/rateLimit.js';
import { uploadMemory } from '@/lib/uploads.js';
import { webRefreshCookie } from '@/lib/cookies.js';
import { Errors } from '@/lib/errors.js';
import { createAuthService } from '@/modules/auth/auth.service.js';
import {
  AddProviderBody,
  ConfirmPhoneChangeBody,
  RemoveProviderParam,
  SendOtpBody,
  SetPasswordBody,
  StartPhoneChangeBody,
} from '@/modules/auth/auth.schemas.js';
import type { Notifier } from '@/lib/notifier.js';
import type { Provider } from '@/lib/jwt.js';

export function createUsersRouter(prisma: PrismaClient, notifier: Notifier): Router {
  const router = Router();
  const service = createUsersService(prisma);
  const auth = createAuthService(prisma, notifier);

  // Phone-change re-issues tokens — route the web refresh token into a cookie.
  router.use(webRefreshCookie());

  router.get(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      const me = await service.getSelf(req.user!.id);
      res.json(me);
    }),
  );

  router.patch(
    '/me',
    requireAuth,
    validate({ body: UpdateMeBody }),
    asyncHandler(async (req, res) => {
      const updated = await service.updateSelf(
        req.user!.id,
        req.body as { name?: string; language?: 'ru' | 'kg'; termsAccepted?: true },
      );
      res.json(updated);
    }),
  );

  router.delete(
    '/me',
    requireAuth,
    asyncHandler(async (req, res) => {
      await service.deleteSelf(req.user!.id);
      res.status(204).send();
    }),
  );

  // TZ §24.4 — data portability export. Must be BEFORE /:id.
  router.get(
    '/me/export',
    requireAuth,
    asyncHandler(async (req, res) => {
      const dump = await service.exportData(req.user!.id);
      res
        .setHeader(
          'Content-Disposition',
          `attachment; filename="tappjet-export-${req.user!.id}.json"`,
        )
        .setHeader('Content-Type', 'application/json; charset=utf-8')
        .send(JSON.stringify(dump, null, 2));
    }),
  );

  router.get(
    '/:id',
    validate({ params: UserIdParam }),
    asyncHandler(async (req, res) => {
      const profile = await service.getPublicProfile(req.params.id!);
      res.json(profile);
    }),
  );

  router.get(
    '/:id/ratings',
    validate({ params: UserIdParam, query: RatingsQuery }),
    asyncHandler(async (req, res) => {
      const { limit, cursor } = req.query as unknown as {
        limit: number;
        cursor?: string;
      };
      const result = await service.listRatings(req.params.id!, limit, cursor);
      res.json(result);
    }),
  );

  router.post(
    '/avatar',
    requireAuth,
    uploadMemory.single('avatar'),
    asyncHandler(async (req, res) => {
      if (!req.file) throw Errors.validation({ reason: 'missing_file', field: 'avatar' });
      const result = await service.setAvatar(req.user!.id, req.file);
      res.json(result);
    }),
  );

  // ─── v2.1 §8.12 Account management ────────────────────────────────

  router.patch(
    '/me/password',
    requireAuth,
    validate({ body: SetPasswordBody }),
    asyncHandler(async (req, res) => {
      const { currentPassword, newPassword } = req.body as {
        currentPassword?: string;
        newPassword: string;
      };
      await auth.setPassword(req.user!.id, newPassword, currentPassword);
      res.status(204).send();
    }),
  );

  router.patch(
    '/me/phone',
    requireAuth,
    validate({ body: StartPhoneChangeBody }),
    asyncHandler(async (req, res) => {
      const result = await auth.startPhoneChange(
        req.user!.id,
        req.body as Parameters<typeof auth.startPhoneChange>[1],
      );
      res.json(result);
    }),
  );

  // Send an OTP for a NEW phone straight to the user's Telegram chat (no
  // deep-link). Used by the add-phone modal so Telegram users never leave the
  // Mini App. Falls back to the deep-link flow client-side on telegram_dm_unavailable.
  router.post(
    '/me/phone/send-otp',
    requireAuth,
    sendOtpMinuteLimit,
    sendOtpDailyLimit,
    validate({ body: SendOtpBody }),
    asyncHandler(async (req, res) => {
      const { phone } = req.body as { phone: string };
      const result = await auth.sendPhoneOtpToUser(req.user!.id, phone);
      res.json(result);
    }),
  );

  router.patch(
    '/me/phone/confirm',
    requireAuth,
    validate({ body: ConfirmPhoneChangeBody }),
    asyncHandler(async (req, res) => {
      const { newPhone, code } = req.body as { newPhone: string; code: string };
      const ua = req.header('user-agent')?.slice(0, 300);
      const result = await auth.confirmPhoneChange(req.user!.id, newPhone, code, ua);
      res.json(result);
    }),
  );

  router.post(
    '/me/providers',
    requireAuth,
    validate({ body: AddProviderBody }),
    asyncHandler(async (req, res) => {
      const result = await auth.addProvider(
        req.user!.id,
        req.body as Parameters<typeof auth.addProvider>[1],
      );
      res.status(201).json(result);
    }),
  );

  router.delete(
    '/me/providers/:provider',
    requireAuth,
    validate({ params: RemoveProviderParam }),
    asyncHandler(async (req, res) => {
      await auth.removeProvider(req.user!.id, req.params.provider as Provider);
      res.status(204).send();
    }),
  );

  return router;
}
