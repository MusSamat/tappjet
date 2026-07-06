import { logger } from '@/lib/logger.js';

export interface SmsProvider {
  send(phone: string, text: string): Promise<void>;
}

// Captured messages are accessible to tests via getSentMessages(). The array
// grows unbounded in dev — intentional, it's a debug tool. Tests reset it.
const sent: { phone: string; text: string; at: Date }[] = [];

// Record a delivery in the local capture buffer. Used by the mock provider and
// by the Telegram Gateway fallback when no token is configured, so dev/test
// flows can still read the code via getSentMessages().
export function recordSent(phone: string, text: string): void {
  sent.push({ phone, text, at: new Date() });
  logger.info({ phone, text }, '[OTP CAPTURE]');
}

// ───────────────────────────────────────────────────────────────────────────
// SMS delivery is DISABLED for the Telegram-only testing period. OTP now goes
// through Telegram Gateway (see lib/telegramGateway.ts). The real providers
// (Mega.kg, Nikita) are commented out; re-enable by restoring getSmsProvider()
// and the SMS delivery call in auth.otp.ts.
// ───────────────────────────────────────────────────────────────────────────
//
// const MockProvider: SmsProvider = {
//   async send(phone, text) {
//     recordSent(phone, text);
//   },
// };
//
// export function getSmsProvider(): SmsProvider {
//   if (env.SMS_PROVIDER === 'mock') return MockProvider;
//   throw new Error(`SMS provider "${env.SMS_PROVIDER}" is not implemented yet`);
// }

export function getSentMessages(): ReadonlyArray<{ phone: string; text: string; at: Date }> {
  return sent;
}

export function clearSentMessages(): void {
  sent.length = 0;
}
