import type { Prisma, PrismaClient } from '@prisma/client';
import { logger } from '@/lib/logger.js';

/**
 * Shared engagement (views + likes) for trips and passenger requests.
 *
 * Design:
 *   • views — UNIQUE viewers (not raw opens): one `listing_views` row per
 *     (listing, viewer_key), where viewer_key is "u:<userId>" for logged-in
 *     users or "a:<anonId>" for anonymous visitors (lists/details are public).
 *     views_count is incremented only on the first unique view. Owner self-views
 *     are never counted. Counting is triggered by an explicit client call on
 *     detail open (not server-side / SSR), so crawlers & prefetch don't inflate.
 *   • likes — polymorphic `listing_likes` table (target_type, target_id, user_id)
 *     with a UNIQUE that makes like a toggle; likes_count denormalized for reads.
 */

export type ListingTarget = 'trip' | 'passenger_request';

type CounterDelegate = {
  update(args: {
    where: { id: string };
    data: Prisma.TripUpdateInput | Prisma.PassengerRequestUpdateInput;
  }): Promise<unknown>;
};

export function createEngagementService(prisma: PrismaClient) {
  // Pick the right model delegate for the denormalized counters.
  function counter(
    db: PrismaClient | Prisma.TransactionClient,
    target: ListingTarget,
  ): CounterDelegate {
    return target === 'trip' ? db.trip : db.passengerRequest;
  }

  /**
   * Record a unique view. Fire-and-forget — never blocks. Counts at most once per
   * viewer per listing; owner self-views and viewers without a key are ignored.
   */
  async function recordView(
    target: ListingTarget,
    id: string,
    viewer: { userId: string | null; anonId: string | null },
  ): Promise<void> {
    const viewerKey = viewer.userId
      ? `u:${viewer.userId}`
      : viewer.anonId
        ? `a:${viewer.anonId}`
        : null;
    if (!viewerKey) return; // can't dedup → don't count

    const ownerId =
      target === 'trip'
        ? (await prisma.trip.findUnique({ where: { id }, select: { driverId: true } }))?.driverId
        : (await prisma.passengerRequest.findUnique({ where: { id }, select: { passengerId: true } }))
            ?.passengerId;
    if (!ownerId) return; // listing gone
    if (viewer.userId && viewer.userId === ownerId) return; // skip owner self-view

    try {
      // Early stage: EVERY open counts (repeat views inflate deliberately —
      // lively counters sell the marketplace). Self-views stay excluded above.
      await counter(prisma, target).update({
        where: { id },
        data: { viewsCount: { increment: 1 } },
      });
      // First-view audit row is kept (unique per viewer) — repeats just skip it.
      await prisma.listingView
        .create({ data: { targetType: target, targetId: id, viewerKey } })
        .catch((err: unknown) => {
          if ((err as { code?: string }).code === 'P2002') return;
          throw err;
        });
    } catch (err) {
      logger.warn({ err, target, id }, 'recordView failed');
    }
  }

  /** Toggle a like on. Returns true if newly liked, false if it already existed. */
  async function like(
    target: ListingTarget,
    id: string,
    userId: string,
  ): Promise<boolean> {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.listingLike.create({
          data: { targetType: target, targetId: id, userId },
        });
        await counter(tx, target).update({
          where: { id },
          data: { likesCount: { increment: 1 } },
        });
      });
      return true;
    } catch (err) {
      // P2002 = already liked → idempotent no-op, counter untouched.
      if (typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002') {
        return false;
      }
      throw err;
    }
  }

  /** Toggle a like off. Returns true if a like was removed. */
  async function unlike(
    target: ListingTarget,
    id: string,
    userId: string,
  ): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      const del = await tx.listingLike.deleteMany({
        where: { targetType: target, targetId: id, userId },
      });
      if (del.count === 0) return false;
      await counter(tx, target).update({
        where: { id },
        data: { likesCount: { decrement: 1 } },
      });
      return true;
    });
  }

  /** Whether a single listing is liked by the viewer (null viewer → false). */
  async function isLiked(
    target: ListingTarget,
    id: string,
    viewerId: string | null,
  ): Promise<boolean> {
    if (!viewerId) return false;
    const row = await prisma.listingLike.findUnique({
      where: { targetType_targetId_userId: { targetType: target, targetId: id, userId: viewerId } },
    });
    return row !== null;
  }

  /** Batch: which of these listing ids the viewer has liked (for list views). */
  async function likedIds(
    target: ListingTarget,
    ids: string[],
    viewerId: string | null,
  ): Promise<Set<string>> {
    if (!viewerId || ids.length === 0) return new Set();
    const rows = await prisma.listingLike.findMany({
      where: { targetType: target, targetId: { in: ids }, userId: viewerId },
      select: { targetId: true },
    });
    return new Set(rows.map((r) => r.targetId));
  }

  return { recordView, like, unlike, isLiked, likedIds };
}

export type EngagementService = ReturnType<typeof createEngagementService>;
