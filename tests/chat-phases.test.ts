import { describe, it, expect, vi } from 'vitest';
import { testPrisma } from './setup.js';
import { createUser, createVerifiedDriver, createTrip, createBooking, makeNotifier } from './factories.js';
import { createChatService } from '@/modules/chat/chat.service.js';
import { NoopNotifier } from '@/lib/notifier.js';

const noop = new NoopNotifier();

async function setup() {
  const driver = await createVerifiedDriver(testPrisma);
  const passenger = await createUser(testPrisma);
  const trip = await createTrip(testPrisma, driver.id);
  return { driver, passenger, trip };
}

// ─── Phase labelling ─────────────────────────────────────────────────

describe('chat phases — pre_booking', () => {
  it('stamps chatPhase=pre_booking on messages sent while booking is pending', async () => {
    const { passenger, trip } = await setup();
    const booking = await createBooking(testPrisma, passenger.id, trip.id, { status: 'pending' });
    const svc = createChatService(testPrisma, noop);

    const { message } = await svc.send(booking.id, passenger.id, 'Привет, места есть?');
    expect(message.chatPhase).toBe('pre_booking');
  });

  it('stamps chatPhase=pre_booking while booking status is viewed', async () => {
    const { passenger, trip } = await setup();
    const booking = await createBooking(testPrisma, passenger.id, trip.id, { status: 'viewed' });
    const svc = createChatService(testPrisma, noop);

    const { message } = await svc.send(booking.id, passenger.id, 'Ещё актуально?');
    expect(message.chatPhase).toBe('pre_booking');
  });

  it('stamps chatPhase=full once booking is accepted', async () => {
    const { passenger, trip } = await setup();
    const booking = await createBooking(testPrisma, passenger.id, trip.id, { status: 'accepted' });

    // Make the trip active too (chat write gate checks trip status).
    await testPrisma.trip.update({ where: { id: trip.id }, data: { status: 'active' } });

    const svc = createChatService(testPrisma, noop);
    const { message } = await svc.send(booking.id, passenger.id, 'Во сколько выезжаем?');
    expect(message.chatPhase).toBe('full');
  });
});

// ─── Pre-booking limit ───────────────────────────────────────────────

describe('chat phases — pre_booking limit', () => {
  it('blocks the 11th message with pre_booking_limit_reached', async () => {
    const { passenger, trip } = await setup();
    const booking = await createBooking(testPrisma, passenger.id, trip.id, { status: 'pending' });
    const svc = createChatService(testPrisma, noop);

    for (let i = 0; i < 10; i++) {
      await svc.send(booking.id, passenger.id, `msg ${i}`);
    }

    await expect(
      svc.send(booking.id, passenger.id, 'сообщение 11'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', details: { reason: 'pre_booking_limit_reached' } });
  });

  it('emits chat:limit_warning when the 8th message is sent', async () => {
    const chatLimitWarning = vi.fn();
    const svc = createChatService(testPrisma, makeNotifier({ chatLimitWarning }));
    const { passenger, trip } = await setup();
    const booking = await createBooking(testPrisma, passenger.id, trip.id, { status: 'pending' });

    for (let i = 0; i < 7; i++) {
      await svc.send(booking.id, passenger.id, `msg ${i}`);
    }
    expect(chatLimitWarning).not.toHaveBeenCalled();

    await svc.send(booking.id, passenger.id, 'msg 8');
    expect(chatLimitWarning).toHaveBeenCalledWith(booking.id, 2);
  });
});

// ─── Content filtering ────────────────────────────────────────────────

describe('chat phases — content filtering', () => {
  it('redacts phone numbers in pre_booking phase', async () => {
    const { passenger, trip } = await setup();
    const booking = await createBooking(testPrisma, passenger.id, trip.id, { status: 'pending' });
    const svc = createChatService(testPrisma, noop);

    const { message } = await svc.send(booking.id, passenger.id, 'Позвони мне: +996700123456');
    expect(message.text).not.toContain('+996700123456');
    expect(message.isFiltered).toBe(true);
  });

  it('redacts social links in pre_booking phase', async () => {
    const { passenger, trip } = await setup();
    const booking = await createBooking(testPrisma, passenger.id, trip.id, { status: 'pending' });
    const svc = createChatService(testPrisma, noop);

    const { message } = await svc.send(booking.id, passenger.id, 'Пиши мне t.me/myuser');
    expect(message.text).not.toContain('t.me/myuser');
    expect(message.isFiltered).toBe(true);
  });

  it('does NOT redact social links in full phase', async () => {
    const { passenger, trip } = await setup();
    const booking = await createBooking(testPrisma, passenger.id, trip.id, { status: 'accepted' });
    await testPrisma.trip.update({ where: { id: trip.id }, data: { status: 'active' } });
    const svc = createChatService(testPrisma, noop);

    const { message } = await svc.send(booking.id, passenger.id, 'Ссылка: t.me/myuser');
    expect(message.text).toContain('t.me/myuser');
    expect(message.isFiltered).toBe(false);
  });

  it('still redacts phone numbers in full phase', async () => {
    const { passenger, trip } = await setup();
    const booking = await createBooking(testPrisma, passenger.id, trip.id, { status: 'accepted' });
    await testPrisma.trip.update({ where: { id: trip.id }, data: { status: 'active' } });
    const svc = createChatService(testPrisma, noop);

    const { message } = await svc.send(booking.id, passenger.id, 'Набери +996 700 123456');
    expect(message.text).not.toContain('700 123456');
    expect(message.isFiltered).toBe(true);
  });
});

// ─── Access control ──────────────────────────────────────────────────

describe('chat — access control', () => {
  it('blocks writes on a rejected booking', async () => {
    const { passenger, trip } = await setup();
    const booking = await createBooking(testPrisma, passenger.id, trip.id, { status: 'rejected' });
    const svc = createChatService(testPrisma, noop);

    await expect(
      svc.send(booking.id, passenger.id, 'попытка'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('blocks writes from non-participants', async () => {
    const { passenger, trip } = await setup();
    const booking = await createBooking(testPrisma, passenger.id, trip.id, { status: 'pending' });
    const outsider = await createUser(testPrisma);
    const svc = createChatService(testPrisma, noop);

    await expect(
      svc.send(booking.id, outsider.id, 'нарушение'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
