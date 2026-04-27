import { beforeEach, describe, expect, it } from 'vitest';
import { testPrisma } from '../../../tests/setup.js';
import { escalateVerificationsJob } from './escalateVerifications.js';
import { createUser } from '../../../tests/factories.js';

describe('escalate_verifications cron', () => {
  beforeEach(() => {
    // setup.ts truncates between tests — nothing to do here.
  });

  it('emits a notification per driver with pending > 24h, skips fresh ones', async () => {
    const stale = await createUser(testPrisma);
    const fresh = await createUser(testPrisma);

    await testPrisma.driverProfile.createMany({
      data: [
        {
          userId: stale.id,
          carMake: 'T',
          carModel: 'M',
          carYear: 2010,
          carColor: 'W',
          carPlate: 'OLD1',
          seatsCount: 4,
          licensePhotoPath: 'x',
          carPassportPath: 'x',
          carPhotoPath: 'x',
          selfiePath: 'x',
          verificationStatus: 'pending',
          submittedAt: new Date(Date.now() - 30 * 60 * 60_000), // 30h ago
        },
        {
          userId: fresh.id,
          carMake: 'T',
          carModel: 'M',
          carYear: 2010,
          carColor: 'W',
          carPlate: 'NEW1',
          seatsCount: 4,
          licensePhotoPath: 'x',
          carPassportPath: 'x',
          carPhotoPath: 'x',
          selfiePath: 'x',
          verificationStatus: 'pending',
          submittedAt: new Date(Date.now() - 2 * 60 * 60_000), // 2h ago
        },
      ],
    });

    await escalateVerificationsJob.run(testPrisma);

    const emitted = await testPrisma.notification.findMany({
      where: { type: 'verification_sla_breach' },
    });
    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.userId).toBe(stale.id);
    expect((emitted[0]!.payload as { car_plate: string }).car_plate).toBe('OLD1');
  });

  it('is a no-op when no breaches', async () => {
    await escalateVerificationsJob.run(testPrisma);
    const emitted = await testPrisma.notification.findMany();
    expect(emitted).toHaveLength(0);
  });
});
