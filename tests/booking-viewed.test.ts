import { describe, it, expect, vi } from 'vitest';
import { testPrisma } from './setup.js';
import { createUser, createVerifiedDriver, createTrip, createBooking, makeNotifier } from './factories.js';
import { createBookingsService } from '@/modules/bookings/bookings.service.js';
import { NoopNotifier } from '@/lib/notifier.js';

const noop = new NoopNotifier();

async function setup() {
  const driver = await createVerifiedDriver(testPrisma);
  const passenger = await createUser(testPrisma);
  const trip = await createTrip(testPrisma, driver.id);
  return { driver, passenger, trip };
}

// ─── markViewed ──────────────────────────────────────────────────────

describe('BookingsService.markViewed', () => {
  it('transitions pending → viewed and stamps viewedAt', async () => {
    const { driver, passenger, trip } = await setup();
    const booking = await createBooking(testPrisma, passenger.id, trip.id, { status: 'pending' });
    const svc = createBookingsService(testPrisma, noop);

    await svc.markViewed(booking.id, driver.id);

    const updated = await testPrisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(updated.status).toBe('viewed');
    expect(updated.viewedAt).not.toBeNull();
  });

  it('emits bookingViewed notification to the passenger', async () => {
    const bookingViewed = vi.fn();
    const svc = createBookingsService(testPrisma, makeNotifier({ bookingViewed }));
    const { driver, passenger, trip } = await setup();
    const booking = await createBooking(testPrisma, passenger.id, trip.id, { status: 'pending' });

    await svc.markViewed(booking.id, driver.id);

    expect(bookingViewed).toHaveBeenCalledWith(
      passenger.id,
      expect.objectContaining({ bookingId: booking.id }),
    );
  });

  it('is idempotent — second call does not overwrite viewedAt', async () => {
    const { driver, passenger, trip } = await setup();
    const booking = await createBooking(testPrisma, passenger.id, trip.id, { status: 'pending' });
    const svc = createBookingsService(testPrisma, noop);

    await svc.markViewed(booking.id, driver.id);
    const first = await testPrisma.booking.findUniqueOrThrow({ where: { id: booking.id } });

    await svc.markViewed(booking.id, driver.id);
    const second = await testPrisma.booking.findUniqueOrThrow({ where: { id: booking.id } });

    expect(second.viewedAt?.getTime()).toBe(first.viewedAt?.getTime());
  });

  it('silently skips if the caller is not the driver', async () => {
    const { passenger, trip } = await setup();
    const booking = await createBooking(testPrisma, passenger.id, trip.id, { status: 'pending' });
    const outsider = await createUser(testPrisma);
    const svc = createBookingsService(testPrisma, noop);

    await svc.markViewed(booking.id, outsider.id);

    const unchanged = await testPrisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    expect(unchanged.status).toBe('pending');
    expect(unchanged.viewedAt).toBeNull();
  });

  it('silently skips if the booking does not exist', async () => {
    const { driver } = await setup();
    const svc = createBookingsService(testPrisma, noop);
    await expect(svc.markViewed('00000000-0000-0000-0000-000000000000', driver.id)).resolves.toBeUndefined();
  });
});

// ─── accept / reject with viewed status ─────────────────────────────

describe('BookingsService.accept — viewed booking', () => {
  it('accepts a booking that is in viewed status', async () => {
    const { driver, passenger, trip } = await setup();
    const booking = await createBooking(testPrisma, passenger.id, trip.id, {
      status: 'viewed',
      viewedAt: new Date(),
    });
    const svc = createBookingsService(testPrisma, noop);

    const dto = await svc.accept(booking.id, driver.id);
    expect(dto.status).toBe('accepted');
  });
});

describe('BookingsService.reject — viewed booking', () => {
  it('rejects a booking that is in viewed status', async () => {
    const { driver, passenger, trip } = await setup();
    const booking = await createBooking(testPrisma, passenger.id, trip.id, {
      status: 'viewed',
      viewedAt: new Date(),
    });
    const svc = createBookingsService(testPrisma, noop);

    const dto = await svc.reject(booking.id, driver.id, 'нет мест');
    expect(dto.status).toBe('rejected');
  });
});

// ─── listIncoming includes viewed ────────────────────────────────────

describe('BookingsService.listIncoming', () => {
  it('returns both pending and viewed bookings', async () => {
    const { driver, passenger, trip } = await setup();
    const passenger2 = await createUser(testPrisma);

    await createBooking(testPrisma, passenger.id, trip.id, { status: 'pending' });
    await createBooking(testPrisma, passenger2.id, trip.id, { status: 'viewed', viewedAt: new Date() });

    const svc = createBookingsService(testPrisma, noop);
    const result = await svc.listIncoming(driver.id, { limit: 20 });

    expect(result.data).toHaveLength(2);
    const statuses = result.data.map((b) => b.status);
    expect(statuses).toContain('pending');
    expect(statuses).toContain('viewed');
  });

  it('does not return accepted bookings', async () => {
    const { driver, passenger, trip } = await setup();
    await createBooking(testPrisma, passenger.id, trip.id, { status: 'accepted' });

    const svc = createBookingsService(testPrisma, noop);
    const result = await svc.listIncoming(driver.id, { limit: 20 });

    expect(result.data).toHaveLength(0);
  });
});
