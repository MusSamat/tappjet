import type { PrismaClient } from '@prisma/client';
import { Errors, publicPhone } from '@/lib/errors.js';

/**
 * Phone reveal («Позвонить») — call-first marketplace flow. A logged-in user
 * taps the button and gets the counterparty's phone immediately, no booking
 * required. Every reveal is audited in contact_reveals; a daily distinct-
 * context limit stops scrapers cold while never bothering real users.
 */

const DAILY_REVEAL_LIMIT = 30;

export interface RevealedContact {
  phone: string;
  name: string;
}

export function createContactsService(prisma: PrismaClient) {
  async function assertUnderDailyLimit(viewerId: string): Promise<void> {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const used = await prisma.contactReveal.count({
      where: { viewerId, createdAt: { gte: dayAgo } },
    });
    if (used >= DAILY_REVEAL_LIMIT) {
      throw Errors.rateLimited({ reason: 'contact_reveal_daily_limit' });
    }
  }

  async function audit(
    viewerId: string,
    targetUserId: string,
    contextType: 'trip' | 'passenger_request',
    contextId: string,
  ): Promise<void> {
    // Repeat taps on the same trip/request don't create rows (and so don't
    // eat the daily limit) — unique (viewer, context).
    await prisma.contactReveal
      .create({ data: { viewerId, targetUserId, contextType, contextId } })
      .catch((err: unknown) => {
        if ((err as { code?: string }).code === 'P2002') return; // already revealed
        throw err;
      });
  }

  /** Driver's phone for an active trip. */
  async function revealForTrip(tripId: string, viewerId: string): Promise<RevealedContact> {
    const trip = await prisma.trip.findUnique({
      where: { id: tripId },
      select: {
        status: true,
        driverId: true,
        driver: { select: { phone: true, name: true } },
      },
    });
    if (!trip) throw Errors.notFound('Trip');
    if (trip.driverId === viewerId) throw Errors.validation({ reason: 'own_trip' });
    if (trip.status !== 'active') throw Errors.tripNotActive();

    // Telegram-only accounts carry a "+tg:<id>" placeholder — never leak it.
    const phone = publicPhone(trip.driver.phone);
    if (!phone) throw Errors.conflict('User has no public phone', { reason: 'no_phone' });

    const already = await prisma.contactReveal.findUnique({
      where: {
        viewerId_contextType_contextId: { viewerId, contextType: 'trip', contextId: tripId },
      },
    });
    if (!already) await assertUnderDailyLimit(viewerId);
    await audit(viewerId, trip.driverId, 'trip', tripId);
    return { phone, name: trip.driver.name };
  }

  /** Passenger's phone for an open ride request. */
  async function revealForRequest(requestId: string, viewerId: string): Promise<RevealedContact> {
    const request = await prisma.passengerRequest.findUnique({
      where: { id: requestId },
      select: {
        status: true,
        passengerId: true,
        passenger: { select: { phone: true, name: true } },
      },
    });
    if (!request) throw Errors.notFound('Request');
    if (request.passengerId === viewerId) throw Errors.validation({ reason: 'own_request' });
    if (request.status !== 'open') {
      throw Errors.conflict('Request is not open', { current_status: request.status });
    }

    const phone = publicPhone(request.passenger.phone);
    if (!phone) throw Errors.conflict('User has no public phone', { reason: 'no_phone' });

    const already = await prisma.contactReveal.findUnique({
      where: {
        viewerId_contextType_contextId: {
          viewerId,
          contextType: 'passenger_request',
          contextId: requestId,
        },
      },
    });
    if (!already) await assertUnderDailyLimit(viewerId);
    await audit(viewerId, request.passengerId, 'passenger_request', requestId);
    return { phone, name: request.passenger.name };
  }

  return { revealForTrip, revealForRequest };
}
