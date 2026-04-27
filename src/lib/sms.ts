import { env } from '@/config/env.js';
import { logger } from '@/lib/logger.js';

export interface SmsProvider {
  send(phone: string, text: string): Promise<void>;
}

// Captured messages are accessible to tests via getSentMessages(). The array
// grows unbounded in dev — intentional, it's a debug tool. Tests reset it.
const sent: { phone: string; text: string; at: Date }[] = [];

const MockProvider: SmsProvider = {
  async send(phone, text) {
    sent.push({ phone, text, at: new Date() });
    logger.info({ phone, text }, '[MOCK SMS]');
  },
};

// Real providers (Mega.kg, Nikita) to be wired in Sprint 2 — keeping the
// abstraction so swap is one line. For now unknown providers throw.
export function getSmsProvider(): SmsProvider {
  if (env.SMS_PROVIDER === 'mock') return MockProvider;
  throw new Error(`SMS provider "${env.SMS_PROVIDER}" is not implemented yet`);
}

export function getSentMessages(): ReadonlyArray<{ phone: string; text: string; at: Date }> {
  return sent;
}

export function clearSentMessages(): void {
  sent.length = 0;
}
