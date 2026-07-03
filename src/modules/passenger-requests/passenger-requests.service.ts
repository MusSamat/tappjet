import type { PrismaClient } from '@prisma/client';
import { Errors } from '@/lib/errors.js';
import { toFileUrl } from '@/lib/uploads.js';
import { createEngagementService } from '@/lib/engagement.js';
import type { Notifier } from '@/lib/notifier.js';
import type { CreatePassengerRequestInput, ListRequestsInput, RespondInput } from './passenger-requests.schemas.js';

export interface PassengerRequestDTO {
  id: string;
  passengerId: string;
  originCity: string;
  destinationCity: string;
  seatsNeeded: number;
  departureDate: string;
  flexible: boolean;
  comment: string | null;
  status: string;
  createdAt: string;
  liked: boolean;
  metrics: { views: number; likes: number } | null;
  passenger: {
    id: string;
    name: string;
    avatarUrl: string | null;
    rating: number | null;
    ratingCount: number;
  };
}

const RATING_VISIBLE_AFTER = 3;

export function toDTO(
  row: {
    id: string;
    passengerId: string;
    originCity: string;
    destinationCity: string;
    seatsNeeded: number;
    departureDate: Date;
    flexible: boolean;
    comment: string | null;
    status: string;
    createdAt: Date;
    viewsCount: number;
    likesCount: number;
    passenger: {
      id: string;
      name: string;
      avatarUrl: string | null;
      rating: { toNumber: () => number } | number;
      ratingCount: number;
    };
  },
  opts: { liked: boolean; isOwner: boolean },
): PassengerRequestDTO {
  return {
    id: row.id,
    passengerId: row.passengerId,
    originCity: row.originCity,
    destinationCity: row.destinationCity,
    seatsNeeded: row.seatsNeeded,
    departureDate: row.departureDate.toISOString(),
    flexible: row.flexible,
    comment: row.comment,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    liked: opts.liked,
    metrics: opts.isOwner ? { views: row.viewsCount, likes: row.likesCount } : null,
    passenger: {
      id: row.passenger.id,
      name: row.passenger.name,
      avatarUrl: toFileUrl(row.passenger.avatarUrl),
      rating:
        row.passenger.ratingCount >= RATING_VISIBLE_AFTER
          ? typeof row.passenger.rating === 'number'
            ? row.passenger.rating
            : row.passenger.rating.toNumber()
          : null,
      ratingCount: row.passenger.ratingCount,
    },
  };
}

export const passengerSelect = {
  id: true,
  name: true,
  avatarUrl: true,
  rating: true,
  ratingCount: true,
} as const;

export function createPassengerRequestsService(prisma: PrismaClient) {
  const engagement = createEngagementService(prisma);

  async function create(
    passengerId: string,
    input: CreatePassengerRequestInput,
  ): Promise<PassengerRequestDTO> {
    const departure = new Date(input.departureDate);
    const now = new Date();

    if (departure <= now) {
      throw Errors.validation({ departureDate: 'must be in the future' });
    }
    const maxAhead = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000); // 60 days
    if (departure > maxAhead) {
      throw Errors.validation({ departureDate: 'too far ahead (max 60 days)' });
    }

    // Validate cities exist
    const [origin, dest] = await Promise.all([
      prisma.city.findFirst({ where: { nameRu: input.originCity, isActive: true } }),
      prisma.city.findFirst({ where: { nameRu: input.destinationCity, isActive: true } }),
    ]);
    if (!origin) throw Errors.validation({ originCity: 'unknown city' });
    if (!dest) throw Errors.validation({ destinationCity: 'unknown city' });

    const row = await prisma.passengerRequest.create({
      data: {
        passengerId,
        originCity: input.originCity,
        destinationCity: input.destinationCity,
        seatsNeeded: input.seatsNeeded,
        departureDate: departure,
        flexible: input.flexible ?? false,
        comment: input.comment ?? null,
        status: 'open',
      },
      include: { passenger: { select: passengerSelect } },
    });

    return toDTO(row, { liked: false, isOwner: true });
  }

  async function list(
    input: ListRequestsInput,
    viewerId: string | null = null,
  ): Promise<{ data: PassengerRequestDTO[]; nextCursor: string | null }> {
    const take = input.limit + 1;
    const now = new Date();

    const rows = await prisma.passengerRequest.findMany({
      where: {
        status: 'open',
        departureDate: { gte: now },
        ...(input.from_city ? { originCity: input.from_city } : {}),
        ...(input.to_city ? { destinationCity: input.to_city } : {}),
        ...(input.date ? { departureDate: { gte: new Date(input.date) } } : {}),
        ...(input.seats ? { seatsNeeded: { gte: input.seats } } : {}),
      },
      orderBy: [{ departureDate: 'asc' }, { createdAt: 'desc' }],
      take,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      include: { passenger: { select: passengerSelect } },
    });

    const hasMore = rows.length > input.limit;
    const slice = hasMore ? rows.slice(0, input.limit) : rows;
    const likedSet = await engagement.likedIds('passenger_request', slice.map((r) => r.id), viewerId);
    return {
      data: slice.map((r) =>
        toDTO(r, {
          liked: likedSet.has(r.id),
          isOwner: viewerId !== null && r.passengerId === viewerId,
        }),
      ),
      nextCursor: hasMore ? slice[slice.length - 1]!.id : null,
    };
  }

  async function listMy(passengerId: string): Promise<{ data: PassengerRequestDTO[]; nextCursor: string | null }> {
    const rows = await prisma.passengerRequest.findMany({
      where: { passengerId },
      orderBy: [{ createdAt: 'desc' }],
      include: { passenger: { select: passengerSelect } },
    });
    const likedSet = await engagement.likedIds('passenger_request', rows.map((r) => r.id), passengerId);
    return {
      data: rows.map((r) => toDTO(r, { liked: likedSet.has(r.id), isOwner: true })),
      nextCursor: null,
    };
  }

  async function cancel(id: string, passengerId: string): Promise<void> {
    const req = await prisma.passengerRequest.findUnique({ where: { id } });
    if (!req) throw Errors.notFound('PassengerRequest');
    if (req.passengerId !== passengerId) throw Errors.forbidden();
    if (req.status !== 'open') throw Errors.conflict('Request is not open');

    await prisma.passengerRequest.update({
      where: { id },
      data: { status: 'cancelled' },
    });
  }

  async function getById(id: string, viewerId: string | null = null): Promise<PassengerRequestDTO> {
    const row = await prisma.passengerRequest.findUnique({
      where: { id },
      include: { passenger: { select: passengerSelect } },
    });
    if (!row) throw Errors.notFound('PassengerRequest');
    const liked = await engagement.isLiked('passenger_request', id, viewerId);
    // Views are counted via an explicit client POST /:id/view, not on read.
    return toDTO(row, { liked, isOwner: viewerId !== null && row.passengerId === viewerId });
  }

  async function like(id: string, userId: string): Promise<{ liked: boolean }> {
    const req = await prisma.passengerRequest.findUnique({ where: { id }, select: { id: true } });
    if (!req) throw Errors.notFound('PassengerRequest');
    await engagement.like('passenger_request', id, userId);
    return { liked: true };
  }

  async function recordView(
    id: string,
    viewer: { userId: string | null; anonId: string | null },
  ): Promise<void> {
    await engagement.recordView('passenger_request', id, viewer);
  }

  async function unlike(id: string, userId: string): Promise<{ liked: boolean }> {
    await engagement.unlike('passenger_request', id, userId);
    return { liked: false };
  }

  return { create, list, listMy, cancel, getById, like, unlike, recordView };
}

// ─── Response DTO ─────────────────────────────────────────────────────
export interface RequestResponseDTO {
  id: string;
  requestId: string;
  driverId: string;
  price: number;
  departureTime: string;
  message: string | null;
  status: string;
  bookingId: string | null;
  expiresAt: string;
  createdAt: string;
  driver: {
    id: string;
    name: string;
    avatarUrl: string | null;
    rating: number | null;
    ratingCount: number;
    verified: boolean;
  };
}

const RESPONSE_TTL_HOURS = 48;

function toResponseDTO(row: {
  id: string;
  requestId: string;
  driverId: string;
  price: number;
  departureTime: Date;
  message: string | null;
  status: string;
  bookingId: string | null;
  expiresAt: Date;
  createdAt: Date;
  driver: {
    id: string;
    name: string;
    avatarUrl: string | null;
    rating: { toNumber: () => number } | number;
    ratingCount: number;
    driverProfile: { verificationStatus: string } | null;
  };
}): RequestResponseDTO {
  return {
    id: row.id,
    requestId: row.requestId,
    driverId: row.driverId,
    price: row.price,
    departureTime: row.departureTime.toISOString(),
    message: row.message,
    status: row.status,
    bookingId: row.bookingId,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    driver: {
      id: row.driver.id,
      name: row.driver.name,
      avatarUrl: toFileUrl(row.driver.avatarUrl),
      rating:
        row.driver.ratingCount >= RATING_VISIBLE_AFTER
          ? typeof row.driver.rating === 'number'
            ? row.driver.rating
            : row.driver.rating.toNumber()
          : null,
      ratingCount: row.driver.ratingCount,
      verified: row.driver.driverProfile?.verificationStatus === 'verified',
    },
  };
}

const driverResponseSelect = {
  id: true,
  name: true,
  avatarUrl: true,
  rating: true,
  ratingCount: true,
  driverProfile: { select: { verificationStatus: true } },
} as const;

export function createPassengerRequestResponsesService(prisma: PrismaClient, notifier: Notifier) {
  async function respond(driverId: string, requestId: string, input: RespondInput): Promise<RequestResponseDTO> {
    const request = await prisma.passengerRequest.findUnique({ where: { id: requestId } });
    if (!request) throw Errors.notFound('PassengerRequest');
    if (request.status !== 'open') throw Errors.conflict('Request is not open');
    if (request.passengerId === driverId) throw Errors.validation({ reason: 'cannot_respond_to_own_request' });

    const departureTime = new Date(input.departureTime);
    if (departureTime <= new Date()) throw Errors.validation({ departureTime: 'must be in the future' });

    const expiresAt = new Date(Date.now() + RESPONSE_TTL_HOURS * 60 * 60_000);

    const existing = await prisma.passengerRequestResponse.findUnique({
      where: { requestId_driverId: { requestId, driverId } },
    });
    if (existing && existing.status === 'pending') {
      throw Errors.conflict('Already responded to this request');
    }

    let row;
    if (existing) {
      row = await prisma.passengerRequestResponse.update({
        where: { id: existing.id },
        data: { price: input.price, departureTime, message: input.message ?? null, status: 'pending', expiresAt },
        include: { driver: { select: driverResponseSelect } },
      });
    } else {
      row = await prisma.passengerRequestResponse.create({
        data: { requestId, driverId, price: input.price, departureTime, message: input.message ?? null, expiresAt },
        include: { driver: { select: driverResponseSelect } },
      });
    }

    const driver = await prisma.user.findUnique({ where: { id: driverId }, select: { name: true } });

    await notifier.requestResponseReceived(request.passengerId, {
      responseId: row.id,
      requestId,
      driverName: driver?.name ?? 'Водитель',
      price: input.price,
      departureTime,
    });

    return toResponseDTO(row);
  }

  async function listResponses(requestId: string, passengerId: string): Promise<RequestResponseDTO[]> {
    const request = await prisma.passengerRequest.findUnique({ where: { id: requestId } });
    if (!request) throw Errors.notFound('PassengerRequest');
    if (request.passengerId !== passengerId) throw Errors.forbidden();

    const rows = await prisma.passengerRequestResponse.findMany({
      where: { requestId, status: { in: ['pending', 'accepted', 'declined'] } },
      orderBy: [{ createdAt: 'asc' }],
      include: { driver: { select: driverResponseSelect } },
    });

    return rows.map(toResponseDTO);
  }

  async function acceptResponse(passengerId: string, requestId: string, responseId: string): Promise<{ bookingId: string }> {
    const result = await prisma.$transaction(async (tx) => {
      const response = await tx.passengerRequestResponse.findUnique({ where: { id: responseId } });
      if (!response || response.requestId !== requestId) throw Errors.notFound('Response');
      if (response.status !== 'pending') throw Errors.conflict('Response not pending', { current_status: response.status });
      if (response.expiresAt < new Date()) throw Errors.conflict('Response expired');

      const request = await tx.passengerRequest.findUnique({ where: { id: requestId } });
      if (!request) throw Errors.notFound('PassengerRequest');
      if (request.passengerId !== passengerId) throw Errors.forbidden();
      if (request.status !== 'open') throw Errors.conflict('Request already closed');

      // Create a Trip for the driver
      const trip = await tx.trip.create({
        data: {
          driverId: response.driverId,
          originCity: request.originCity,
          destinationCity: request.destinationCity,
          originAddress: request.originCity,
          departureAt: response.departureTime,
          estimatedDurationMin: 0,
          seatsTotal: request.seatsNeeded,
          seatsAvailable: 0,
          pricePerSeat: response.price,
          // 'direct' bypasses the one-active-per-day partial unique index
          // (driver_id, date) WHERE status='active'. These trips are private
          // arrangements not visible in public search.
          status: 'direct',
        },
      });

      // Create accepted booking directly
      const booking = await tx.booking.create({
        data: {
          tripId: trip.id,
          passengerId,
          seatsCount: request.seatsNeeded,
          status: 'accepted',
        },
      });

      // Mark this response accepted
      await tx.passengerRequestResponse.update({
        where: { id: responseId },
        data: { status: 'accepted', bookingId: booking.id },
      });

      // Decline all other pending responses
      await tx.passengerRequestResponse.updateMany({
        where: { requestId, status: 'pending', id: { not: responseId } },
        data: { status: 'declined' },
      });

      // Close the request
      await tx.passengerRequest.update({
        where: { id: requestId },
        data: { status: 'closed' },
      });

      return { bookingId: booking.id, driverId: response.driverId };
    });

    const passenger = await prisma.user.findUnique({ where: { id: passengerId }, select: { name: true } });

    await notifier.requestResponseAccepted(result.driverId, {
      responseId,
      requestId,
      bookingId: result.bookingId,
      passengerName: passenger?.name ?? 'Пассажир',
    });

    // Notify declined drivers
    const declinedResponses = await prisma.passengerRequestResponse.findMany({
      where: { requestId, status: 'declined', id: { not: responseId } },
      select: { id: true, driverId: true },
    });
    await Promise.all(
      declinedResponses.map((r) =>
        notifier.requestResponseDeclined(r.driverId, { responseId: r.id, requestId }),
      ),
    );

    return { bookingId: result.bookingId };
  }

  async function declineResponse(passengerId: string, requestId: string, responseId: string): Promise<void> {
    const response = await prisma.passengerRequestResponse.findUnique({ where: { id: responseId } });
    if (!response || response.requestId !== requestId) throw Errors.notFound('Response');
    if (response.status !== 'pending') throw Errors.conflict('Response not pending');

    const request = await prisma.passengerRequest.findUnique({ where: { id: requestId } });
    if (!request) throw Errors.notFound('PassengerRequest');
    if (request.passengerId !== passengerId) throw Errors.forbidden();

    await prisma.passengerRequestResponse.update({
      where: { id: responseId },
      data: { status: 'declined' },
    });

    await notifier.requestResponseDeclined(response.driverId, { responseId, requestId });
  }

  return { respond, listResponses, acceptResponse, declineResponse };
}
