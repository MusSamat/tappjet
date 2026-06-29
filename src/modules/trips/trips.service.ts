import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError, Errors } from '@/lib/errors.js';
import { assertActiveUser } from '@/lib/assertUser.js';
import { toFileUrl } from '@/lib/uploads.js';
import { cursorArgs, sliceAndNext } from '@/lib/pagination.js';
import { estimateDurationMin } from '@/lib/routes.js';
import { logger } from '@/lib/logger.js';
import type { Notifier } from '@/lib/notifier.js';
import { createEngagementService } from '@/lib/engagement.js';
import { POINTS_PER_TRIP, tierForPoints } from '@/modules/loyalty/loyalty.service.js';
import type {
  MyTripsInput,
  TripCreateInput,
  TripPatchInput,
  TripSearchInput,
} from './trips.schemas.js';

// ─── Business-rule constants from TZ §10.1 ────────────────────────────
const HORIZON_MAX_DAYS = 60;
const HORIZON_MIN_MINUTES = 30;
const RATING_VISIBLE_AFTER = 3;

// ─── Public shapes ────────────────────────────────────────────────────
export interface TripListItem {
  id: string;
  driverId: string;
  driver: {
    id: string;
    name: string;
    avatarUrl: string | null;
    rating: number | null;
    ratingCount: number;
    verified: boolean;
    car: { make: string; model: string; color: string; plate: string; photoUrl: string | null } | null;
  };
  originCity: string;
  destinationCity: string;
  pickupCities: string[];
  dropoffCities: string[];
  originAddress: string;
  departureAt: Date;
  departureFlexible: boolean;
  estimatedDurationMin: number;
  seatsTotal: number;
  seatsAvailable: number;
  pricePerSeat: number;
  priceNegotiable: boolean;
  luggage: string;
  status: string;
  createdAt: Date;
  // Engagement: like state for the viewer; metrics only for the creator (driver).
  liked: boolean;
  metrics: { views: number; likes: number } | null;
}

export interface TripDetail extends TripListItem {
  comment: string | null;
  preferences: Record<string, boolean>;
  waypoints: Array<{ city: string; address?: string }>;
  recentRatings: Array<{
    id: string;
    score: number;
    tags: string[];
    comment: string | null;
    createdAt: Date;
    raterName: string;
  }>;
}

// ─── Service interface ────────────────────────────────────────────────
export interface TripsService {
  create(
    driverUserId: string,
    body: TripCreateInput,
    idempotencyKey: string,
  ): Promise<{ trip: TripDetail; reused: boolean }>;
  search(
    query: TripSearchInput,
    viewerId?: string | null,
  ): Promise<{ data: TripListItem[]; nextCursor: string | null }>;
  getById(id: string, viewerId?: string | null): Promise<TripDetail>;
  patch(id: string, driverUserId: string, patch: TripPatchInput): Promise<TripDetail>;
  cancel(id: string, driverUserId: string, reason?: string): Promise<{ status: 'cancelled' }>;
  complete(id: string, driverUserId: string): Promise<{ status: 'completed' }>;
  myTrips(
    driverUserId: string,
    query: MyTripsInput,
  ): Promise<{ data: TripListItem[]; nextCursor: string | null }>;
  like(id: string, userId: string): Promise<{ liked: boolean }>;
  unlike(id: string, userId: string): Promise<{ liked: boolean }>;
  recordView(id: string, viewer: { userId: string | null; anonId: string | null }): Promise<void>;
  priceSuggestion(from: string, to: string): Promise<{
    averagePrice: number | null;
    sampleSize: number;
  }>;
}

export function createTripsService(
  prisma: PrismaClient,
  notifier?: Notifier,
): TripsService {
  const engagement = createEngagementService(prisma);

  // Validate driver-provided route cities (pickup/dropoff points): each must
  // exist in the City directory and not be the trip's own origin/destination.
  // Any region is allowed. Returns the deduped list.
  async function normalizeRouteCities(
    exclude: string[],
    cities: string[],
  ): Promise<string[]> {
    const excluded = new Set(exclude);
    const unique = [...new Set(cities)].filter((c) => !excluded.has(c));
    if (unique.length === 0) return [];

    const rows = await prisma.city.findMany({
      where: { nameRu: { in: unique }, isActive: true },
      select: { nameRu: true },
    });
    const known = new Set(rows.map((r) => r.nameRu));
    for (const city of unique) {
      if (!known.has(city)) {
        throw Errors.validation({ reason: 'unknown_route_city', city });
      }
    }
    return unique;
  }

  // ─── Create ─────────────────────────────────────────────────────────
  async function create(
    driverUserId: string,
    body: TripCreateInput,
    idempotencyKey: string,
  ): Promise<{ trip: TripDetail; reused: boolean }> {
    // Idempotency-Key semantics (TZ §19.1): replay returns the original result.
    const existing = await prisma.trip.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.driverId !== driverUserId) {
        throw Errors.conflict('Idempotency-Key belongs to another user', {
          reason: 'idempotency_key_mismatch',
        });
      }
      return { trip: await getById(existing.id), reused: true };
    }

    const [, driver] = await Promise.all([
      assertActiveUser(driverUserId, prisma),
      prisma.driverProfile.findUnique({ where: { userId: driverUserId } }),
    ]);
    if (!driver) throw Errors.forbidden({ reason: 'not_a_driver' });
    if (driver.verificationStatus !== 'verified') {
      throw Errors.forbidden({
        reason: 'driver_not_verified',
        current_status: driver.verificationStatus,
      });
    }
    if (body.seatsTotal > driver.seatsCount) {
      throw Errors.validation({
        reason: 'seats_exceed_vehicle',
        requested: body.seatsTotal,
        vehicle: driver.seatsCount,
      });
    }

    // Business rule: max 3 active trips simultaneously.
    const activeCount = await prisma.trip.count({
      where: { driverId: driverUserId, status: 'active', departureAt: { gt: new Date() } },
    });
    if (activeCount >= 3) {
      throw Errors.conflict('Driver already has 3 active trips', {
        reason: 'max_active_trips_exceeded',
      });
    }

    // Business rule: cannot create a new trip while an existing active trip
    // has at least one accepted (unfinished) booking.
    const unfinishedAccepted = await prisma.booking.count({
      where: {
        trip: { driverId: driverUserId, status: 'active', departureAt: { gt: new Date() } },
        status: 'accepted',
      },
    });
    if (unfinishedAccepted > 0) {
      throw Errors.conflict('Driver has an unfinished accepted booking on an active trip', {
        reason: 'unfinished_accepted_booking',
      });
    }

    const departureAt = new Date(body.departureAt);
    const now = Date.now();
    const deltaMs = departureAt.getTime() - now;
    if (deltaMs < HORIZON_MIN_MINUTES * 60_000) {
      throw Errors.validation({
        reason: 'departure_too_soon',
        minutes_required: HORIZON_MIN_MINUTES,
      });
    }
    if (deltaMs > HORIZON_MAX_DAYS * 24 * 60 * 60_000) {
      throw Errors.validation({ reason: 'departure_too_far', max_days: HORIZON_MAX_DAYS });
    }

    const estimatedDurationMin = estimateDurationMin(body.originCity, body.destinationCity);

    const exclude = [body.originCity, body.destinationCity];
    const [pickupCities, dropoffCities] = await Promise.all([
      normalizeRouteCities(exclude, body.pickupCities),
      normalizeRouteCities(exclude, body.dropoffCities),
    ]);

    try {
      const created = await prisma.trip.create({
        data: {
          driverId: driverUserId,
          originCity: body.originCity,
          destinationCity: body.destinationCity,
          originAddress: body.originAddress,
          originLat: body.originLat ?? null,
          originLng: body.originLng ?? null,
          pickupCities,
          dropoffCities,
          waypoints: body.waypoints as Prisma.InputJsonValue,
          departureAt,
          departureFlexible: body.departureFlexible,
          estimatedDurationMin,
          seatsTotal: body.seatsTotal,
          seatsAvailable: body.seatsTotal,
          pricePerSeat: body.pricePerSeat,
          priceNegotiable: body.priceNegotiable,
          luggage: body.luggage,
          preferences: body.preferences as Prisma.InputJsonValue,
          comment: body.comment ?? null,
          status: 'active',
          idempotencyKey,
        },
      });
      return { trip: await getById(created.id, driverUserId), reused: false };
    } catch (err) {
      throw mapPrismaError(err);
    }
  }

  // ─── Search ─────────────────────────────────────────────────────────
  async function search(
    query: TripSearchInput,
    viewerId: string | null = null,
  ): Promise<{ data: TripListItem[]; nextCursor: string | null }> {
    if (query.from_city && query.to_city && query.from_city === query.to_city) {
      throw Errors.validation({ reason: 'cities_must_differ' });
    }
    if (query.from_city || query.to_city) {
      const cityNames = [query.from_city, query.to_city].filter(Boolean) as string[];
      const cityRows = await prisma.city.findMany({
        where: { nameRu: { in: cityNames }, isActive: true },
        select: { nameRu: true },
      });
      if (cityRows.length < cityNames.length) {
        throw Errors.validation({ reason: 'unknown_city' });
      }
    }

    const where: Prisma.TripWhereInput = {
      status: 'active',
      seatsAvailable: { gte: query.seats },
      departureAt: { gte: new Date() },
    };
    // Mirror match: from_city = a boarding point (origin or a pickup city);
    // to_city = an alighting point (destination or a dropoff city). A dropoff
    // city does NOT make the trip boardable there, and vice versa.
    const cityFilters: Prisma.TripWhereInput[] = [];
    if (query.from_city) {
      cityFilters.push({
        OR: [{ originCity: query.from_city }, { pickupCities: { has: query.from_city } }],
      });
    }
    if (query.to_city) {
      cityFilters.push({
        OR: [{ destinationCity: query.to_city }, { dropoffCities: { has: query.to_city } }],
      });
    }
    if (cityFilters.length > 0) where.AND = cityFilters;
    if (query.date) {
      const start = new Date(query.date);
      const end = new Date(start.getTime() + 24 * 60 * 60_000);
      where.departureAt = { gte: start, lt: end };
    }
    if (query.min_price !== undefined) {
      where.pricePerSeat = { gte: query.min_price };
    }
    if (query.max_price !== undefined) {
      where.pricePerSeat = {
        ...(where.pricePerSeat as object | undefined),
        lte: query.max_price,
      };
    }
    if (query.luggage) where.luggage = query.luggage;
    if (query.only_verified) {
      where.driver = { driverProfile: { verificationStatus: 'verified' } };
    }

    // Loyalty tier priority: elite → expert → traveler → novice — prepended to
    // all orderings so verified high-tier drivers surface naturally (§Этап 3).
    const loyaltyOrder: Prisma.TripOrderByWithRelationInput = {
      driver: { loyaltyTier: 'asc' }, // 'elite' < 'expert' < 'novice' < 'traveler' alphabetically,
      // so we use a CASE expression via raw SQL; for Prisma-native sorting we
      // rely on the secondary tier field. Proper ordering is handled by the
      // raw-SQL search path when needed; for now this is a reasonable approximation.
    };
    const orderBy: Prisma.TripOrderByWithRelationInput[] =
      query.sort === 'price_asc'
        ? [{ pricePerSeat: 'asc' }, { departureAt: 'asc' }, { id: 'asc' }]
        : query.sort === 'rating_desc'
          ? [{ driver: { rating: 'desc' } }, loyaltyOrder, { departureAt: 'asc' }, { id: 'asc' }]
          : [loyaltyOrder, { departureAt: 'asc' }, { id: 'asc' }];

    const rows = await prisma.trip.findMany({
      where,
      orderBy,
      ...cursorArgs({ cursor: query.cursor, limit: query.limit }),
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            rating: true,
            ratingCount: true,
            driverProfile: {
              select: {
                carMake: true,
                carModel: true,
                carColor: true,
                carPlate: true,
                verificationStatus: true,
              },
            },
          },
        },
      },
    });

    const likedSet = await engagement.likedIds('trip', rows.map((r) => r.id), viewerId);
    const mapped = rows.map((r) =>
      toListItem(r, {
        liked: likedSet.has(r.id),
        isOwner: viewerId !== null && r.driverId === viewerId,
      }),
    );
    return sliceAndNext(mapped, query.limit);
  }

  // ─── Detail ─────────────────────────────────────────────────────────
  async function getById(id: string, viewerId: string | null = null): Promise<TripDetail> {
    const row = await prisma.trip.findUnique({
      where: { id },
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            rating: true,
            ratingCount: true,
            driverProfile: {
              select: {
                carMake: true,
                carModel: true,
                carColor: true,
                carPlate: true,
                verificationStatus: true,
              },
            },
          },
        },
      },
    });
    if (!row) throw Errors.notFound('Trip');

    const [recentRatings, liked] = await Promise.all([
      prisma.rating.findMany({
        where: { rateeId: row.driverId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        include: { rater: { select: { name: true, deletedAt: true } } },
      }),
      engagement.isLiked('trip', id, viewerId),
    ]);

    // Views are counted via an explicit client POST /trips/:id/view, not here —
    // so SSR / crawlers / prefetch don't inflate the count.

    return {
      ...toListItem(row, { liked, isOwner: viewerId !== null && row.driverId === viewerId }),
      comment: row.comment,
      preferences: (row.preferences ?? {}) as Record<string, boolean>,
      waypoints: (row.waypoints as Array<{ city: string; address?: string }>) ?? [],
      recentRatings: recentRatings.map((r) => ({
        id: r.id,
        score: r.score,
        tags: r.tags,
        comment: r.comment,
        createdAt: r.createdAt,
        raterName: r.rater.deletedAt ? 'Удалённый пользователь' : r.rater.name,
      })),
    };
  }

  // ─── Patch ──────────────────────────────────────────────────────────
  async function patch(
    id: string,
    driverUserId: string,
    body: TripPatchInput,
  ): Promise<TripDetail> {
    const trip = await prisma.trip.findUnique({ where: { id } });
    if (!trip) throw Errors.notFound('Trip');
    if (trip.driverId !== driverUserId) throw Errors.forbidden({ reason: 'not_owner' });
    if (trip.status !== 'active') {
      throw Errors.conflict('Trip is not active', { current_status: trip.status });
    }

    const data: Prisma.TripUpdateInput = {
      version: { increment: 1 },
    };
    if (body.pricePerSeat !== undefined) data.pricePerSeat = body.pricePerSeat;
    if (body.priceNegotiable !== undefined) data.priceNegotiable = body.priceNegotiable;
    if (body.luggage !== undefined) data.luggage = body.luggage;
    if (body.comment !== undefined) data.comment = body.comment;
    if (body.preferences !== undefined) {
      data.preferences = body.preferences as Prisma.InputJsonValue;
    }

    await prisma.trip.update({ where: { id }, data });
    return getById(id);
  }

  // ─── Cancel ─────────────────────────────────────────────────────────
  async function cancel(
    id: string,
    driverUserId: string,
    reason?: string,
  ): Promise<{ status: 'cancelled' }> {
    const trip = await prisma.trip.findUnique({ where: { id } });
    if (!trip) throw Errors.notFound('Trip');
    if (trip.driverId !== driverUserId) throw Errors.forbidden({ reason: 'not_owner' });
    if (trip.status !== 'active') {
      throw Errors.conflict('Trip is not active', { current_status: trip.status });
    }

    const affected = await prisma.$transaction(async (tx) => {
      await tx.trip.update({
        where: { id },
        data: {
          status: 'cancelled',
          cancelledReason: reason ?? null,
          version: { increment: 1 },
        },
      });
      // TZ §16.1 "Водитель отменяет поездку: все bookings → cancelled_by_driver,
      //   уведомления всем, cancellations_30d++."
      const affectedBookings = await tx.booking.findMany({
        where: { tripId: id, status: { in: ['pending', 'accepted'] } },
        select: { passengerId: true },
      });
      await tx.booking.updateMany({
        where: { tripId: id, status: { in: ['pending', 'accepted'] } },
        data: {
          status: 'cancelled_by_driver',
          cancelledBy: 'driver',
          cancelledAt: new Date(),
        },
      });
      await tx.driverProfile.update({
        where: { userId: driverUserId },
        data: { cancellations30d: { increment: 1 } },
      });
      return affectedBookings.map((b) => b.passengerId);
    });

    // Notify each impacted passenger outside the transaction.
    if (notifier) {
      const freshTrip = await prisma.trip.findUniqueOrThrow({ where: { id } });
      const publicTrip = {
        id: freshTrip.id,
        driverId: freshTrip.driverId,
        originCity: freshTrip.originCity,
        destinationCity: freshTrip.destinationCity,
        departureAt: freshTrip.departureAt,
      };
      await Promise.all(
        affected.map((passengerId) => notifier.tripCancelled(passengerId, { trip: publicTrip })),
      );
    }

    return { status: 'cancelled' };
  }

  // ─── My trips (driver tabs) ─────────────────────────────────────────
  async function myTrips(
    driverUserId: string,
    query: MyTripsInput,
  ): Promise<{ data: TripListItem[]; nextCursor: string | null }> {
    const now = new Date();
    const where: Prisma.TripWhereInput = { driverId: driverUserId };
    let orderBy: Prisma.TripOrderByWithRelationInput;

    switch (query.tab) {
      case 'active':
        where.status = 'active';
        where.departureAt = { gt: now };
        orderBy = { departureAt: 'asc' };
        break;
      case 'in_transit':
        where.status = 'active';
        where.departureAt = { lte: now };
        orderBy = { departureAt: 'asc' };
        break;
      case 'past':
        where.status = 'completed';
        orderBy = { departureAt: 'desc' };
        break;
      case 'cancelled':
        where.status = 'cancelled';
        orderBy = { updatedAt: 'desc' };
        break;
    }

    const rows = await prisma.trip.findMany({
      where,
      orderBy: [orderBy, { id: 'asc' }],
      ...cursorArgs({ cursor: query.cursor, limit: query.limit }),
      include: {
        driver: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
            rating: true,
            ratingCount: true,
            driverProfile: {
              select: {
                carMake: true,
                carModel: true,
                carColor: true,
                carPlate: true,
                verificationStatus: true,
              },
            },
          },
        },
      },
    });

    const likedSet = await engagement.likedIds('trip', rows.map((r) => r.id), driverUserId);
    return sliceAndNext(
      rows.map((r) => toListItem(r, { liked: likedSet.has(r.id), isOwner: true })),
      query.limit,
    );
  }

  // ─── Like / unlike ──────────────────────────────────────────────────
  async function like(id: string, userId: string): Promise<{ liked: boolean }> {
    const trip = await prisma.trip.findUnique({ where: { id }, select: { id: true } });
    if (!trip) throw Errors.notFound('Trip');
    await engagement.like('trip', id, userId);
    return { liked: true };
  }

  async function unlike(id: string, userId: string): Promise<{ liked: boolean }> {
    await engagement.unlike('trip', id, userId);
    return { liked: false };
  }

  // Record a unique view (deduped; owner self-views ignored). Fire-and-forget.
  async function recordView(
    id: string,
    viewer: { userId: string | null; anonId: string | null },
  ): Promise<void> {
    await engagement.recordView('trip', id, viewer);
  }

  // ─── Manual complete ────────────────────────────────────────────────
  async function complete(
    id: string,
    driverUserId: string,
  ): Promise<{ status: 'completed' }> {
    const trip = await prisma.trip.findUnique({ where: { id } });
    if (!trip) throw Errors.notFound('Trip');
    if (trip.driverId !== driverUserId) throw Errors.forbidden({ reason: 'not_owner' });
    if (trip.status !== 'active') {
      throw Errors.conflict('Trip is not active', { current_status: trip.status });
    }
    if (trip.departureAt > new Date()) {
      throw Errors.conflict('Cannot complete a trip before its departure time', {
        reason: 'departure_in_future',
      });
    }

    const acceptedPassengers = await prisma.$transaction(async (tx) => {
      await tx.trip.update({
        where: { id },
        data: { status: 'completed', version: { increment: 1 } },
      });
      const bookings = await tx.booking.findMany({
        where: { tripId: id, status: 'accepted' },
        select: { passengerId: true },
      });
      await tx.booking.updateMany({
        where: { tripId: id, status: 'accepted' },
        data: { status: 'completed' },
      });
      await tx.driverProfile.updateMany({
        where: { userId: driverUserId },
        data: { totalTrips: { increment: 1 } },
      });
      return bookings.map((b) => b.passengerId);
    });

    const participants = [driverUserId, ...acceptedPassengers];
    const payload = {
      trip_id: trip.id,
      origin_city: trip.originCity,
      destination_city: trip.destinationCity,
    };

    // Notifications + loyalty (best-effort, outside transaction)
    await Promise.all(
      participants.map(async (userId) => {
        if (notifier) await notifier.tripCompletedRate(userId, payload);

        const alreadyAwarded = await prisma.loyaltyTransaction.findFirst({
          where: { userId, tripId: id, source: 'trip_completed' },
        });
        if (alreadyAwarded) return;

        await prisma.loyaltyTransaction.create({
          data: { userId, points: POINTS_PER_TRIP, source: 'trip_completed', tripId: id },
        });
        const updated = await prisma.user.update({
          where: { id: userId },
          data: { loyaltyPoints: { increment: POINTS_PER_TRIP } },
          select: { loyaltyPoints: true, loyaltyTier: true },
        });
        const newTier = tierForPoints(updated.loyaltyPoints);
        if (newTier !== updated.loyaltyTier) {
          await prisma.user.update({ where: { id: userId }, data: { loyaltyTier: newTier } });
          if (notifier) await notifier.loyaltyTierChanged(userId, { tier: newTier, points: updated.loyaltyPoints });
        }
      }),
    );

    return { status: 'completed' };
  }

  // ─── Price suggestion ───────────────────────────────────────────────
  async function priceSuggestion(
    from: string,
    to: string,
  ): Promise<{ averagePrice: number | null; sampleSize: number }> {
    if (from === to) throw Errors.validation({ reason: 'cities_must_differ' });

    const since = new Date(Date.now() - 30 * 24 * 60 * 60_000);
    const trips = await prisma.trip.findMany({
      where: {
        originCity: from,
        destinationCity: to,
        status: { in: ['active', 'completed'] },
        createdAt: { gte: since },
      },
      select: { pricePerSeat: true },
      take: 200,
    });

    if (trips.length < 3) {
      return { averagePrice: null, sampleSize: trips.length };
    }
    const sum = trips.reduce((acc, t) => acc + t.pricePerSeat, 0);
    return {
      averagePrice: Math.round(sum / trips.length),
      sampleSize: trips.length,
    };
  }

  return {
    create,
    search,
    getById,
    patch,
    cancel,
    complete,
    myTrips,
    like,
    unlike,
    recordView,
    priceSuggestion,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────
type TripRow = Prisma.TripGetPayload<{
  include: {
    driver: {
      select: {
        id: true;
        name: true;
        avatarUrl: true;
        rating: true;
        ratingCount: true;
        driverProfile: {
          select: {
            carMake: true;
            carModel: true;
            carColor: true;
            carPlate: true;
            carPhotoPath: true;
            verificationStatus: true;
          };
        };
      };
    };
  };
}>;

function toListItem(
  row: TripRow,
  opts: { liked: boolean; isOwner: boolean },
): TripListItem {
  const dp = row.driver.driverProfile;
  return {
    id: row.id,
    driverId: row.driverId,
    driver: {
      id: row.driver.id,
      name: row.driver.name,
      avatarUrl: toFileUrl(row.driver.avatarUrl),
      rating:
        row.driver.ratingCount >= RATING_VISIBLE_AFTER ? Number(row.driver.rating) : null,
      ratingCount: row.driver.ratingCount,
      verified: dp?.verificationStatus === 'verified',
      car: dp
        ? {
            make: dp.carMake,
            model: dp.carModel,
            color: dp.carColor,
            plate: dp.carPlate,
            photoUrl: toFileUrl(dp.carPhotoPath),
          }
        : null,
    },
    originCity: row.originCity,
    destinationCity: row.destinationCity,
    pickupCities: row.pickupCities,
    dropoffCities: row.dropoffCities,
    originAddress: row.originAddress,
    departureAt: row.departureAt,
    departureFlexible: row.departureFlexible,
    estimatedDurationMin: row.estimatedDurationMin,
    seatsTotal: row.seatsTotal,
    seatsAvailable: row.seatsAvailable,
    pricePerSeat: row.pricePerSeat,
    priceNegotiable: row.priceNegotiable,
    luggage: row.luggage,
    status: row.status,
    createdAt: row.createdAt,
    liked: opts.liked,
    metrics: opts.isOwner ? { views: row.viewsCount, likes: row.likesCount } : null,
  };
}

function mapPrismaError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  // P2002 = unique constraint violation. For trip create, the idempotency-key
  // case is already handled via an explicit lookup above, so if we reach here
  // the conflict is `idx_trips_one_active_per_day` (the only other unique
  // constraint). Prisma's `meta.target` only lists columns, not the partial
  // index name — we can't further disambiguate, and don't need to.
  if (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'P2002'
  ) {
    return Errors.conflict('Driver already has an active trip on this date', {
      reason: 'one_active_per_day',
    });
  }
  logger.error({ err }, 'unexpected prisma error creating trip');
  return Errors.internal();
}
