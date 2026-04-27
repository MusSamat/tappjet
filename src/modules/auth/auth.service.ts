import type { PrismaClient } from '@prisma/client';
import type { Notifier } from '@/lib/notifier.js';
import type { AuthService } from './auth.types.js';
import { createOtpMethods, type TelegramSender } from './auth.otp.js';
import { createSessionMethods } from './auth.session.js';
import { createProvidersMethods } from './auth.providers.js';
import { createPasswordMethods } from './auth.password.js';

export function createAuthService(
  prisma: PrismaClient,
  notifier: Notifier,
  bot: TelegramSender | null = null,
): AuthService {
  const otp = createOtpMethods(prisma, bot);
  const session = createSessionMethods(prisma, notifier);
  const providers = createProvidersMethods(prisma);
  const passwordAuth = createPasswordMethods(prisma, otp);

  async function checkPhone(
    phone: string,
  ): Promise<{ exists: boolean; hasPassword: boolean; hasTelegram: boolean }> {
    const user = await prisma.user.findFirst({
      where: { phone, deletedAt: null },
      select: { passwordHash: true, telegramId: true },
    });
    if (!user) return { exists: false, hasPassword: false, hasTelegram: false };
    return { exists: true, hasPassword: !!user.passwordHash, hasTelegram: !!user.telegramId };
  }

  return {
    ...otp,
    ...session,
    ...providers,
    ...passwordAuth,
    checkPhone,
  };
}

export type {
  AuthService,
  AuthResult,
  TokenPair,
  AnyAuthResult,
  ProvisionalAuthResult,
  AdminAuthResult,
} from './auth.types.js';
