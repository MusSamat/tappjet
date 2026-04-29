import type { PrismaClient } from '@prisma/client';
import { Errors, AppError } from '@/lib/errors.js';
import * as password from '@/lib/bcrypt.js';
import { generateOtp, generateUuid } from '@/lib/random.js';
import { getSmsProvider } from '@/lib/sms.js';
import { logger } from '@/lib/logger.js';
import { env } from '@/config/env.js';
import type { Provider } from '@/lib/jwt.js';
import type { AuthResult } from './auth.types.js';
import { issueFullAuthForUser } from './auth.helpers.js';
import {
  OTP_TTL_SEC,
  OTP_MAX_ATTEMPTS,
  OTP_BRUTEFORCE_BLOCK_MIN,
  OTP_DAILY_CAP,
  OTP_MIN_GAP_SEC,
  TELEGRAM_LINK_TOKEN_TTL_SEC,
} from './auth.constants.js';

// Minimal Telegram bot interface — grammy Bot satisfies this at runtime.
export interface TelegramSender {
  api: { sendMessage(chatId: number, text: string): Promise<unknown> };
}

// Module-level so both createOtpMethods and handleTelegramLinkToken can use it.
async function createOtpRecord(prisma: PrismaClient, phone: string): Promise<string> {
  const lastOtp = await prisma.otpCode.findFirst({
    where: { phone },
    orderBy: { createdAt: 'desc' },
  });
  const now = Date.now();
  if (lastOtp && now - lastOtp.createdAt.getTime() < OTP_MIN_GAP_SEC * 1000) {
    throw Errors.rateLimited({ bucket: 'otp_send_min', reason: 'too_soon' });
  }
  const dayAgo = new Date(now - 24 * 60 * 60_000);
  const dayCount = await prisma.otpCode.count({
    where: { phone, createdAt: { gte: dayAgo } },
  });
  if (dayCount >= OTP_DAILY_CAP) {
    throw Errors.rateLimited({ bucket: 'otp_send_day', limit: OTP_DAILY_CAP });
  }
  const code = generateOtp();
  const codeHash = await password.hash(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_SEC * 1000);
  await prisma.otpCode.create({ data: { phone, codeHash, expiresAt } });
  return code;
}

// Called by the grammy /start handler when the user opens the deep-link.
// Validates the token, creates an OTP record, delivers the code via bot,
// and marks the token as sent — all atomically in a transaction.
export async function handleTelegramLinkToken(
  prisma: PrismaClient,
  bot: TelegramSender,
  token: string,
  telegramId: number,
): Promise<void> {
  const record = await prisma.telegramLinkToken.findUnique({ where: { token } });
  if (!record || record.expiresAt.getTime() <= Date.now()) {
    await bot.api.sendMessage(telegramId, 'Ссылка устарела. Начните регистрацию заново.');
    return;
  }
  if (record.status !== 'waiting') {
    await bot.api.sendMessage(telegramId, 'Код уже отправлен. Введите его в браузере.');
    return;
  }

  let code: string;
  try {
    code = await createOtpRecord(prisma, record.phone);
  } catch (err) {
    const isRateLimit = err instanceof AppError && err.code === 'RATE_LIMITED';
    const msg = isRateLimit
      ? 'Слишком много запросов. Подождите минуту и попробуйте снова.'
      : 'Не удалось создать код. Попробуйте позже.';
    await bot.api.sendMessage(telegramId, msg);
    return;
  }

  await prisma.telegramLinkToken.update({
    where: { token },
    data: { telegramId: BigInt(telegramId), status: 'sent' },
  });

  await bot.api.sendMessage(
    telegramId,
    `Tappjet: ${code} — код подтверждения. Срок действия: 10 минут.`,
  );
}

export async function handleBotLoginToken(
  prisma: PrismaClient,
  bot: TelegramSender,
  token: string,
  telegramId: number,
): Promise<void> {
  const record = await prisma.telegramBotLoginToken.findUnique({ where: { token } });
  if (!record || record.expiresAt.getTime() <= Date.now()) {
    await bot.api.sendMessage(telegramId, 'Ссылка устарела. Попробуйте снова.');
    return;
  }
  if (record.status !== 'waiting') {
    await bot.api.sendMessage(telegramId, 'Вход уже выполнен. Вернитесь в приложение.');
    return;
  }
  const user = await prisma.user.findFirst({
    where: { telegramId: BigInt(telegramId), deletedAt: null },
  });
  if (!user) {
    await prisma.telegramBotLoginToken.update({
      where: { token },
      data: { status: 'not_found' },
    });
    await bot.api.sendMessage(
      telegramId,
      'Аккаунт с этим Telegram не найден.\nЗарегистрируйтесь через приложение или войдите по номеру телефона.',
    );
    return;
  }
  if (user.isBlocked) {
    await prisma.telegramBotLoginToken.update({
      where: { token },
      data: { status: 'not_found' },
    });
    await bot.api.sendMessage(telegramId, 'Ваш аккаунт заблокирован. Обратитесь в поддержку.');
    return;
  }
  await prisma.telegramBotLoginToken.update({
    where: { token },
    data: { status: 'done', userId: user.id },
  });
  await bot.api.sendMessage(telegramId, '✅ Вы вошли в Tappjet! Вернитесь в приложение.');
}

export function createOtpMethods(prisma: PrismaClient, bot: TelegramSender | null = null) {
  async function sendOtp(phone: string): Promise<{ expiresInSec: number; debug_code?: string }> {
    const code = await createOtpRecord(prisma, phone);
    const text = `Tappjet: ${code} — код подтверждения. Срок действия: 10 минут.`;
    try {
      await getSmsProvider().send(phone, text);
    } catch (err) {
      logger.error({ err, phone }, 'SMS send failed');
      throw Errors.serviceUnavailable('SMS delivery failed');
    }
    const isDev = process.env.NODE_ENV !== 'production';
    return {
      expiresInSec: OTP_TTL_SEC,
      ...(isDev && { debug_code: code }),
    };
  }

  async function sendTelegramOtp(phone: string): Promise<{ expiresInSec: number }> {
    const user = await prisma.user.findFirst({
      where: { phone, deletedAt: null },
      select: { telegramId: true },
    });
    if (!user) throw Errors.notFound('User');
    if (!user.telegramId) {
      throw Errors.conflict('Telegram not linked to this account', { reason: 'no_telegram_linked' });
    }
    if (!bot) throw Errors.serviceUnavailable('Telegram bot not configured');

    const code = await createOtpRecord(prisma, phone);
    const text = `Tappjet: ${code} — код подтверждения. Срок действия: 10 минут.`;
    try {
      await bot.api.sendMessage(Number(user.telegramId), text);
    } catch (err) {
      logger.error({ err, phone }, 'Telegram OTP send failed');
      throw Errors.serviceUnavailable('Telegram message delivery failed');
    }
    return { expiresInSec: OTP_TTL_SEC };
  }

  async function initTelegramLink(
    phone: string,
  ): Promise<{ token: string; deepLink: string; expiresInSec: number }> {
    // UUID = 36 chars → "reg_" + 36 = 40 chars, well under Telegram's 64-char limit.
    const token = generateUuid();
    const expiresAt = new Date(Date.now() + TELEGRAM_LINK_TOKEN_TTL_SEC * 1000);
    await prisma.telegramLinkToken.create({ data: { token, phone, expiresAt } });
    const deepLink = `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=reg_${token}`;
    return { token, deepLink, expiresInSec: TELEGRAM_LINK_TOKEN_TTL_SEC };
  }

  async function getTelegramLinkStatus(
    token: string,
  ): Promise<{ status: 'waiting' | 'sent' | 'expired' }> {
    const record = await prisma.telegramLinkToken.findUnique({ where: { token } });
    if (!record || record.expiresAt.getTime() <= Date.now()) return { status: 'expired' };
    return { status: record.status as 'waiting' | 'sent' | 'expired' };
  }

  async function verifyOtp(
    phone: string,
    code: string,
    provisionalUserId: string | null,
    provider: Provider,
    deviceInfo?: string,
  ): Promise<AuthResult> {
    const now = new Date();
    const recent = await prisma.otpCode.findFirst({
      where: { phone },
      orderBy: { createdAt: 'desc' },
    });
    if (!recent) throw Errors.otpWrong();

    if (
      recent.attempts >= OTP_MAX_ATTEMPTS &&
      now.getTime() - recent.createdAt.getTime() < OTP_BRUTEFORCE_BLOCK_MIN * 60_000
    ) {
      throw Errors.otpTooManyAttempts();
    }
    if (recent.usedAt) throw Errors.otpWrong();
    if (recent.expiresAt.getTime() <= now.getTime()) throw Errors.otpExpired();

    const match = await password.verify(code, recent.codeHash);
    if (!match) {
      await prisma.otpCode.update({
        where: { id: recent.id },
        data: { attempts: { increment: 1 } },
      });
      throw Errors.otpWrong();
    }

    await prisma.otpCode.update({
      where: { id: recent.id },
      data: { usedAt: now, attempts: { increment: 1 } },
    });

    const user = await prisma.$transaction(async (tx) => {
      if (provisionalUserId) {
        const existing = await tx.user.findUnique({ where: { id: provisionalUserId } });
        if (!existing || existing.deletedAt) throw Errors.unauthorized({ reason: 'user_gone' });
        const phoneOwner = await tx.user.findFirst({
          where: { phone, deletedAt: null, NOT: { id: existing.id } },
        });
        if (phoneOwner) {
          throw Errors.conflict('Phone already linked to another account', {
            reason: 'phone_taken',
            existing_user_id: phoneOwner.id,
          });
        }
        return tx.user.update({ where: { id: existing.id }, data: { phone, phoneVerifiedAt: now } });
      }
      let u = await tx.user.findFirst({ where: { phone, deletedAt: null } });
      if (!u) {
        u = await tx.user.create({
          data: {
            phone,
            name: 'Новый пользователь',
            language: 'ru',
            roles: ['passenger'],
            phoneVerifiedAt: now,
            termsAcceptedAt: now,
          },
        });
      } else if (!u.phoneVerifiedAt) {
        u = await tx.user.update({ where: { id: u.id }, data: { phoneVerifiedAt: now } });
      }
      await tx.authProvider.upsert({
        where: { provider_providerUserId: { provider: 'phone', providerUserId: phone } },
        update: {},
        create: { userId: u.id, provider: 'phone', providerUserId: phone },
      });
      return u;
    });

    if (user.isBlocked) throw Errors.forbidden({ reason: 'blocked' });
    return issueFullAuthForUser(prisma, user.id, provider, deviceInfo);
  }

  const BOT_LOGIN_TTL_SEC = 5 * 60;

  async function initBotLogin(): Promise<{ token: string; deepLink: string; expiresInSec: number }> {
    const token = generateUuid();
    const expiresAt = new Date(Date.now() + BOT_LOGIN_TTL_SEC * 1000);
    await prisma.telegramBotLoginToken.create({ data: { token, expiresAt } });
    const deepLink = `https://t.me/${env.TELEGRAM_BOT_USERNAME}?start=bl_${token}`;
    return { token, deepLink, expiresInSec: BOT_LOGIN_TTL_SEC };
  }

  async function getBotLoginStatus(token: string): Promise<{ status: 'waiting' | 'done' | 'expired' | 'not_found' }> {
    const record = await prisma.telegramBotLoginToken.findUnique({ where: { token } });
    if (!record || record.expiresAt.getTime() <= Date.now()) return { status: 'expired' };
    return { status: record.status as 'waiting' | 'done' | 'expired' | 'not_found' };
  }

  async function claimBotLogin(token: string, deviceInfo?: string): Promise<AuthResult> {
    const record = await prisma.telegramBotLoginToken.findUnique({ where: { token } });
    if (!record || record.status !== 'done' || !record.userId || record.expiresAt.getTime() <= Date.now()) {
      throw Errors.unauthorized({ reason: 'bot_login_invalid' });
    }
    await prisma.telegramBotLoginToken.update({
      where: { token },
      data: { status: 'used', expiresAt: new Date(0) },
    });
    return issueFullAuthForUser(prisma, record.userId, 'telegram', deviceInfo);
  }

  return { sendOtp, sendTelegramOtp, initTelegramLink, getTelegramLinkStatus, verifyOtp, initBotLogin, getBotLoginStatus, claimBotLogin };
}
