import type { PrismaClient } from '@prisma/client';
import { cursorArgs, sliceAndNext } from '@/lib/pagination.js';
import type { Notifier } from '@/lib/notifier.js';

// ─── Tier thresholds (TZ §Этап 3) ───────────────────────────────────
export const TIERS = [
  { name: 'elite',     min: 600 },
  { name: 'expert',    min: 300 },
  { name: 'traveler',  min: 100 },
  { name: 'novice',    min: 0   },
] as const;

export type LoyaltyTier = (typeof TIERS)[number]['name'];

export const POINTS_PER_TRIP = 10;

export function tierForPoints(points: number): LoyaltyTier {
  for (const t of TIERS) {
    if (points >= t.min) return t.name;
  }
  return 'novice';
}

export interface LoyaltyStatus {
  points: number;
  tier: LoyaltyTier;
  nextTier: LoyaltyTier | null;
  pointsToNextTier: number | null;
}

export interface LoyaltyTransaction {
  id: string;
  points: number;
  source: string;
  tripId: string | null;
  note: string | null;
  createdAt: Date;
}

export interface LoyaltyService {
  getStatus(userId: string): Promise<LoyaltyStatus>;
  listTransactions(
    userId: string,
    query: { cursor?: string; limit: number },
  ): Promise<{ data: LoyaltyTransaction[]; nextCursor: string | null }>;
  /** Award points for a completed trip. Called by autoCompleteTrips cron. */
  awardTripPoints(
    userId: string,
    tripId: string,
    prismaOrTx?: PrismaClient,
  ): Promise<void>;
}

export function createLoyaltyService(prisma: PrismaClient, notifier: Notifier): LoyaltyService {
  async function getStatus(userId: string): Promise<LoyaltyStatus> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { loyaltyPoints: true, loyaltyTier: true },
    });
    const points = user?.loyaltyPoints ?? 0;
    const tier = tierForPoints(points) as LoyaltyTier;

    const tierIndex = TIERS.findIndex((t) => t.name === tier);
    const nextTierDef = tierIndex > 0 ? TIERS[tierIndex - 1] : null;
    const nextTier = nextTierDef ? (nextTierDef.name as LoyaltyTier) : null;
    const pointsToNextTier = nextTierDef ? nextTierDef.min - points : null;

    return { points, tier, nextTier, pointsToNextTier };
  }

  async function listTransactions(
    userId: string,
    query: { cursor?: string; limit: number },
  ) {
    const rows = await prisma.loyaltyTransaction.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...cursorArgs({ cursor: query.cursor, limit: query.limit }),
    });
    return sliceAndNext(
      rows.map((r) => ({
        id: r.id,
        points: r.points,
        source: r.source,
        tripId: r.tripId,
        note: r.note,
        createdAt: r.createdAt,
      })),
      query.limit,
    );
  }

  async function awardTripPoints(
    userId: string,
    tripId: string,
    tx?: PrismaClient,
  ): Promise<void> {
    const db = tx ?? prisma;

    // Idempotency: skip if already awarded for this trip.
    const existing = await db.loyaltyTransaction.findFirst({
      where: { userId, tripId, source: 'trip_completed' },
    });
    if (existing) return;

    await db.loyaltyTransaction.create({
      data: { userId, points: POINTS_PER_TRIP, source: 'trip_completed', tripId },
    });

    const user = await db.user.update({
      where: { id: userId },
      data: { loyaltyPoints: { increment: POINTS_PER_TRIP } },
      select: { loyaltyPoints: true, loyaltyTier: true },
    });

    const newTier = tierForPoints(user.loyaltyPoints);
    if (newTier !== user.loyaltyTier) {
      await db.user.update({
        where: { id: userId },
        data: { loyaltyTier: newTier },
      });
      await notifier.loyaltyTierChanged(userId, {
        tier: newTier,
        points: user.loyaltyPoints,
      });
    }
  }

  return { getStatus, listTransactions, awardTripPoints };
}
