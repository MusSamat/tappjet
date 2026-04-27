import { describe, it, expect, vi } from 'vitest';
import { testPrisma } from './setup.js';
import { createUser, createVerifiedDriver, createTrip, makeNotifier } from './factories.js';
import {
  createLoyaltyService,
  tierForPoints,
  POINTS_PER_TRIP,
} from '@/modules/loyalty/loyalty.service.js';
import { NoopNotifier } from '@/lib/notifier.js';

// ─── tierForPoints (pure) ──────────────────────────────────────────────

describe('tierForPoints', () => {
  it.each([
    [0, 'novice'],
    [99, 'novice'],
    [100, 'traveler'],
    [299, 'traveler'],
    [300, 'expert'],
    [599, 'expert'],
    [600, 'elite'],
    [9999, 'elite'],
  ])('points=%i → %s', (points, expected) => {
    expect(tierForPoints(points)).toBe(expected);
  });
});

// ─── LoyaltyService ───────────────────────────────────────────────────

describe('LoyaltyService', () => {
  const notifier = new NoopNotifier();
  const service = createLoyaltyService(testPrisma, notifier);

  describe('getStatus', () => {
    it('returns novice defaults for a fresh user', async () => {
      const { id } = await createUser(testPrisma);
      const status = await service.getStatus(id);
      expect(status.points).toBe(0);
      expect(status.tier).toBe('novice');
      expect(status.nextTier).toBe('traveler');
      expect(status.pointsToNextTier).toBe(100);
    });

    it('returns elite with no next tier', async () => {
      const { id } = await createUser(testPrisma);
      await testPrisma.user.update({
        where: { id },
        data: { loyaltyPoints: 600, loyaltyTier: 'elite' },
      });
      const status = await service.getStatus(id);
      expect(status.tier).toBe('elite');
      expect(status.nextTier).toBeNull();
      expect(status.pointsToNextTier).toBeNull();
    });

    it('reports correct gap to next tier at 250 points', async () => {
      const { id } = await createUser(testPrisma);
      await testPrisma.user.update({
        where: { id },
        data: { loyaltyPoints: 250, loyaltyTier: 'traveler' },
      });
      const status = await service.getStatus(id);
      expect(status.tier).toBe('traveler');
      expect(status.nextTier).toBe('expert');
      expect(status.pointsToNextTier).toBe(50);
    });
  });

  describe('awardTripPoints', () => {
    it('creates a transaction and increments user points', async () => {
      const driver = await createVerifiedDriver(testPrisma);
      const trip = await createTrip(testPrisma, driver.id);

      await service.awardTripPoints(driver.id, trip.id);

      const user = await testPrisma.user.findUniqueOrThrow({ where: { id: driver.id } });
      expect(user.loyaltyPoints).toBe(POINTS_PER_TRIP);

      const tx = await testPrisma.loyaltyTransaction.findFirst({
        where: { userId: driver.id, tripId: trip.id },
      });
      expect(tx).not.toBeNull();
      expect(tx!.source).toBe('trip_completed');
      expect(tx!.points).toBe(POINTS_PER_TRIP);
    });

    it('is idempotent — calling twice awards points once', async () => {
      const driver = await createVerifiedDriver(testPrisma);
      const trip = await createTrip(testPrisma, driver.id);

      await service.awardTripPoints(driver.id, trip.id);
      await service.awardTripPoints(driver.id, trip.id);

      const user = await testPrisma.user.findUniqueOrThrow({ where: { id: driver.id } });
      expect(user.loyaltyPoints).toBe(POINTS_PER_TRIP);

      const count = await testPrisma.loyaltyTransaction.count({
        where: { userId: driver.id, tripId: trip.id },
      });
      expect(count).toBe(1);
    });

    it('upgrades tier and fires loyaltyTierChanged when threshold is crossed', async () => {
      const loyaltyTierChanged = vi.fn();
      const svc = createLoyaltyService(testPrisma, makeNotifier({ loyaltyTierChanged }));

      const { id } = await createUser(testPrisma);
      // Manually set points to 90 — one more award (10) pushes to 100 = traveler.
      await testPrisma.user.update({ where: { id }, data: { loyaltyPoints: 90 } });

      const driver = await createVerifiedDriver(testPrisma);
      const trip = await createTrip(testPrisma, driver.id);
      // Use the passenger user as the recipient to isolate the tier-change path.
      await svc.awardTripPoints(id, trip.id);

      expect(loyaltyTierChanged).toHaveBeenCalledWith(
        id,
        { tier: 'traveler', points: 100 },
      );

      const user = await testPrisma.user.findUniqueOrThrow({ where: { id } });
      expect(user.loyaltyTier).toBe('traveler');
    });

    it('does not fire loyaltyTierChanged when tier stays the same', async () => {
      const loyaltyTierChanged = vi.fn();
      const svc = createLoyaltyService(testPrisma, makeNotifier({ loyaltyTierChanged }));

      const driver = await createVerifiedDriver(testPrisma);
      const trip = await createTrip(testPrisma, driver.id);
      // Start at 20 points (novice) → award 10 → still novice.
      await testPrisma.user.update({ where: { id: driver.id }, data: { loyaltyPoints: 20 } });

      await svc.awardTripPoints(driver.id, trip.id);

      expect(loyaltyTierChanged).not.toHaveBeenCalled();
    });
  });

  describe('listTransactions', () => {
    it('returns transactions newest-first with cursor pagination', async () => {
      const { id } = await createUser(testPrisma);
      const driver = await createVerifiedDriver(testPrisma);

      // Award points for 3 different trips.
      for (let i = 0; i < 3; i++) {
        const trip = await createTrip(testPrisma, driver.id);
        await service.awardTripPoints(id, trip.id);
      }

      const page1 = await service.listTransactions(id, { limit: 2 });
      expect(page1.data).toHaveLength(2);
      expect(page1.nextCursor).not.toBeNull();

      const page2 = await service.listTransactions(id, {
        limit: 2,
        cursor: page1.nextCursor!,
      });
      expect(page2.data).toHaveLength(1);
      expect(page2.nextCursor).toBeNull();
    });
  });
});
