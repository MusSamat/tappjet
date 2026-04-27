import type { PrismaClient } from '@prisma/client';
import { Errors } from '@/lib/errors.js';
import * as password from '@/lib/bcrypt.js';
import { generateOtp } from '@/lib/random.js';
import { getSmsProvider } from '@/lib/sms.js';
import { logger } from '@/lib/logger.js';
import type { Provider } from '@/lib/jwt.js';
import type { AuthResult } from './auth.types.js';
import { issueFullAuthForUser } from './auth.helpers.js';
import {
  OTP_TTL_SEC,
  OTP_MAX_ATTEMPTS,
  OTP_BRUTEFORCE_BLOCK_MIN,
  OTP_DAILY_CAP,
  OTP_MIN_GAP_SEC,
} from './auth.constants.js';

// Minimal Telegram bot interface — grammy Bot satisfies this at runtime.
export interface TelegramSender {
  api: { sendMessage(chatId: number, text: string): Promise<unknown> };
}

export function createOtpMethods(prisma: PrismaClient, bot: TelegramSender | null = null) {
  // Shared rate-limit + code generation used by both SMS and Telegram OTP paths.
  async function createOtpRecord(phone: string): Promise<string> {
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

  async function sendOtp(phone: string): Promise<{ expiresInSec: number }> {
    const code = await createOtpRecord(phone);
    const text = `Tappjet: \${code} — код подтверждения. Срок действия: 10 минут.`;
    try {
      await getSmsProvider().send(phone, text);
    } catch (err) {
      logger.error({ err, phone }, 'SMS send failed');
      throw Errors.serviceUnavailable('SMS delivery failed');
    }
    return { expiresInSec: OTP_TTL_SEC };
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

    const code = await createOtpRecord(phone);
    const text = `Tappjet: \${code} — код подтверждения. Срок действия: 10 минут.`;
    try {
      await bot.api.sendMessage(Number(user.telegramId), text);
    } catch (err) {
      logger.error({ err, phone }, 'Telegram OTP send failed');
      throw Errors.serviceUnavailable('Telegram message delivery failed');
    }
    return { expiresInSec: OTP_TTL_SEC };
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

  return { sendOtp, sendTelegramOtp, verifyOtp };
}
