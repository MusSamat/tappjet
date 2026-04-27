import { beforeEach, describe, expect, it } from 'vitest';
import { testPrisma } from '../../../tests/setup.js';
import { cleanupExpiredOtpJob } from './cleanupOtp.js';

describe('cleanup_expired_otp cron', () => {
  beforeEach(() => {
    // setup.ts truncates between tests
  });

  async function seedOtp(expiresAt: Date, usedAt?: Date) {
    return testPrisma.otpCode.create({
      data: {
        phone:    `+996700${Math.floor(Math.random() * 900_000 + 100_000)}`,
        codeHash: 'fakehash',
        expiresAt,
        usedAt: usedAt ?? null,
      },
    });
  }

  it('deletes OTP codes expired more than 24 hours ago', async () => {
    // expired 25h ago — should be deleted
    await seedOtp(new Date(Date.now() - 25 * 60 * 60_000));
    // expired exactly 24h ago — still inside threshold, should be deleted
    await seedOtp(new Date(Date.now() - 24 * 60 * 60_000 - 1));
    // expired 23h ago — should be kept
    await seedOtp(new Date(Date.now() - 23 * 60 * 60_000));
    // still valid — should be kept
    await seedOtp(new Date(Date.now() + 5 * 60_000));

    await cleanupExpiredOtpJob.run(testPrisma);

    const remaining = await testPrisma.otpCode.findMany();
    expect(remaining).toHaveLength(2);
    expect(remaining.every((r) => r.expiresAt > new Date(Date.now() - 24 * 60 * 60_000))).toBe(true);
  });

  it('also deletes used OTPs that are past the 24h cutoff', async () => {
    const usedAt = new Date(Date.now() - 26 * 60 * 60_000);
    await seedOtp(new Date(Date.now() - 26 * 60 * 60_000), usedAt);

    await cleanupExpiredOtpJob.run(testPrisma);

    expect(await testPrisma.otpCode.count()).toBe(0);
  });

  it('keeps a recently-used OTP (still inside 24h window)', async () => {
    // Used 1h ago but expired 2h ago — should be kept (within 24h cutoff)
    await seedOtp(new Date(Date.now() - 2 * 60 * 60_000), new Date(Date.now() - 60 * 60_000));

    await cleanupExpiredOtpJob.run(testPrisma);

    expect(await testPrisma.otpCode.count()).toBe(1);
  });

  it('is a no-op when there are no OTP rows', async () => {
    await expect(cleanupExpiredOtpJob.run(testPrisma)).resolves.toBeUndefined();
    expect(await testPrisma.otpCode.count()).toBe(0);
  });

  it('does not touch OTPs for other phones', async () => {
    // One old, one recent — only old one gets deleted
    await seedOtp(new Date(Date.now() - 30 * 60 * 60_000));
    await seedOtp(new Date(Date.now() + 10 * 60_000));

    await cleanupExpiredOtpJob.run(testPrisma);

    expect(await testPrisma.otpCode.count()).toBe(1);
  });
});
