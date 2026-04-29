import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { createAuthService } from './auth.service.js';
import type { TelegramSender } from './auth.otp.js';
import {
  AdminLoginBody,
  AdminRefreshBody,
  AppleLoginBody,
  CheckPhoneBody,
  GoogleLoginBody,
  LogoutBody,
  PhoneLoginBody,
  RefreshBody,
  SendOtpBody,
  TelegramLoginBody,
  VerifyOtpBody,
} from './auth.schemas.js';
import { validate } from '@/middleware/validate.js';
import { asyncHandler } from '@/middleware/errorHandler.js';
import { requireAuth } from '@/middleware/auth.js';
import {
  sendOtpDailyLimit,
  sendOtpMinuteLimit,
  telegramAuthLimit,
  verifyOtpLimit,
} from '@/middleware/rateLimit.js';
import { verifyAccessOrProvisional } from '@/lib/jwt.js';
import type { Notifier } from '@/lib/notifier.js';
import { Errors } from '@/lib/errors.js';

export function createAuthRouter(
  prisma: PrismaClient,
  notifier: Notifier,
  bot: TelegramSender | null = null,
): Router {
  const router = Router();
  const service = createAuthService(prisma, notifier, bot);

  // ─── OAuth / Telegram logins ──────────────────────────────────────
  router.post(
    '/telegram',
    telegramAuthLimit,
    validate({ body: TelegramLoginBody }),
    asyncHandler(async (req, res) => {
      const { initData } = req.body as { initData: string };
      const result = await service.loginWithTelegram(
        initData,
        req.header('user-agent')?.slice(0, 300),
      );
      res.status(200).json(result);
    }),
  );

  router.post(
    '/google',
    telegramAuthLimit, // same 10/min/IP cap per TZ §7.6
    validate({ body: GoogleLoginBody }),
    asyncHandler(async (req, res) => {
      const result = await service.loginWithGoogle(
        req.body as { idToken: string },
        req.header('user-agent')?.slice(0, 300),
      );
      res.status(200).json(result);
    }),
  );

  router.post(
    '/apple',
    telegramAuthLimit,
    validate({ body: AppleLoginBody }),
    asyncHandler(async (req, res) => {
      const result = await service.loginWithApple(
        req.body as { identityToken: string },
        req.header('user-agent')?.slice(0, 300),
      );
      res.status(200).json(result);
    }),
  );

  router.post(
    '/phone/login',
    telegramAuthLimit,
    validate({ body: PhoneLoginBody }),
    asyncHandler(async (req, res) => {
      const result = await service.loginWithPhonePassword(
        req.body as { phone: string; password: string },
        req.header('user-agent')?.slice(0, 300),
      );
      res.status(200).json(result);
    }),
  );

  // ─── Phone verification (accepts provisional or unauth) ───────────
  router.post(
    '/phone/send-otp',
    sendOtpMinuteLimit,
    sendOtpDailyLimit,
    validate({ body: SendOtpBody }),
    asyncHandler(async (req, res) => {
      const { phone } = req.body as { phone: string };
      const result = await service.sendOtp(phone);
      res.status(200).json(result);
    }),
  );

  router.post(
    '/phone/verify',
    verifyOtpLimit,
    validate({ body: VerifyOtpBody }),
    asyncHandler(async (req, res) => {
      const { phone, code, deviceInfo } = req.body as {
        phone: string;
        code: string;
        deviceInfo?: string;
      };
      const ua = req.header('user-agent')?.slice(0, 300);

      // If caller holds a provisional token, bind phone to THAT user.
      // Otherwise, /verify is the phone-only registration path (find-or-create).
      const auth = req.header('authorization');
      let provisionalUserId: string | null = null;
      let provider: 'phone' | 'telegram' | 'google' | 'apple' = 'phone';
      if (auth?.startsWith('Bearer ')) {
        const res = verifyAccessOrProvisional(auth.slice(7));
        if (res.kind === 'provisional') {
          provisionalUserId = res.decoded.sub;
          provider = res.decoded.provider;
        }
      }

      const result = await service.verifyOtp(
        phone,
        code,
        provisionalUserId,
        provider,
        deviceInfo ?? ua,
      );
      res.status(200).json(result);
    }),
  );

  // ─── Session lifecycle ────────────────────────────────────────────
  router.post(
    '/refresh',
    validate({ body: RefreshBody }),
    asyncHandler(async (req, res) => {
      const { refreshToken } = req.body as { refreshToken: string };
      const pair = await service.refresh(
        refreshToken,
        req.header('user-agent')?.slice(0, 300),
        req.ip ?? null,
      );
      res.status(200).json(pair);
    }),
  );

  router.post(
    '/logout',
    validate({ body: LogoutBody }),
    asyncHandler(async (req, res) => {
      const { refreshToken } = req.body as { refreshToken: string };
      await service.logout(refreshToken);
      res.status(204).send();
    }),
  );

  router.post(
    '/logout/all',
    requireAuth,
    asyncHandler(async (req, res) => {
      await service.logoutAll(req.user!.id);
      res.status(204).send();
    }),
  );

  // ─── Check phone existence + capabilities ────────────────────────────
  router.post(
    '/check-phone',
    telegramAuthLimit,
    validate({ body: CheckPhoneBody }),
    asyncHandler(async (req, res) => {
      const { phone } = req.body as { phone: string };
      res.status(200).json(await service.checkPhone(phone));
    }),
  );

  // ─── Telegram registration link (deep-link → bot → OTP) ─────────────
  router.post(
    '/telegram/link/init',
    sendOtpMinuteLimit,
    sendOtpDailyLimit,
    validate({ body: SendOtpBody }),
    asyncHandler(async (req, res) => {
      const { phone } = req.body as { phone: string };
      res.status(200).json(await service.initTelegramLink(phone));
    }),
  );

  router.get(
    '/telegram/link/status',
    validate({ query: z.object({ token: z.string().min(1).max(100) }) }),
    asyncHandler(async (req, res) => {
      const { token } = req.query as { token: string };
      res.status(200).json(await service.getTelegramLinkStatus(token));
    }),
  );

  // ─── Telegram bot magic-link login ───────────────────────────────────
  router.post(
    '/telegram/bot-login/init',
    telegramAuthLimit,
    asyncHandler(async (req, res) => {
      res.status(200).json(await service.initBotLogin());
    }),
  );

  router.get(
    '/telegram/bot-login/status',
    validate({ query: z.object({ token: z.string().min(1).max(100) }) }),
    asyncHandler(async (req, res) => {
      const { token } = req.query as { token: string };
      res.status(200).json(await service.getBotLoginStatus(token));
    }),
  );

  router.post(
    '/telegram/bot-login/claim',
    telegramAuthLimit,
    validate({ body: z.object({ token: z.string().min(1).max(100) }) }),
    asyncHandler(async (req, res) => {
      const { token } = req.body as { token: string };
      const deviceInfo = req.headers['user-agent'];
      res.status(200).json(await service.claimBotLogin(token, deviceInfo));
    }),
  );

  // ─── Telegram Bot OTP (login without password / forgot password) ─────
  router.post(
    '/telegram/otp/send',
    sendOtpMinuteLimit,
    sendOtpDailyLimit,
    validate({ body: SendOtpBody }),
    asyncHandler(async (req, res) => {
      const { phone } = req.body as { phone: string };
      res.status(200).json(await service.sendTelegramOtp(phone));
    }),
  );

  // ─── Password reset (post-OTP flow — no current password required) ─
  router.post(
    '/phone/reset-password',
    requireAuth,
    validate({ body: z.object({ newPassword: z.string().min(6).max(128) }) }),
    asyncHandler(async (req, res) => {
      const { newPassword } = req.body as { newPassword: string };
      await service.resetPassword(req.user!.id, newPassword);
      res.status(204).send();
    }),
  );

  // ─── Admin ─────────────────────────────────────────────────────────
  router.post(
    '/admin/login',
    validate({ body: AdminLoginBody }),
    asyncHandler(async (req, res) => {
      const { email, password, totp } = req.body as {
        email: string;
        password: string;
        totp?: string;
      };
      const result = await service.adminLogin(email, password, totp);
      res.status(200).json(result);
    }),
  );

  router.post(
    '/admin/refresh',
    validate({ body: AdminRefreshBody }),
    asyncHandler(async (req, res) => {
      const { refreshToken } = req.body as { refreshToken: string };
      res.status(200).json(await service.adminRefresh(refreshToken));
    }),
  );

  // Export the shared service factory so sibling modules (e.g. users) can
  // reach the password / phone / provider flows without duplicating wiring.
  (router as unknown as { _authService?: ReturnType<typeof createAuthService> })._authService =
    service;
  void Errors; // keep import for asyncHandler guards used elsewhere
  return router;
}
