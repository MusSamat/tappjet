import type { Prisma, PrismaClient } from '@prisma/client';
import { logger } from '@/lib/logger.js';

/**
 * Shared engagement (views + likes) for trips and passenger requests.
 *
 * Design (per product decision):
 *   • views — total opens of a listing's detail; a denormalized counter on the
 *     target row (no per-view rows since unique reach isn't tracked). Owner's
 *     own opens are not counted.
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
   * Increment the view counter. Fire-and-forget at call sites — never block or
   * fail the read it rides on. Skips the owner's own views.
   */
  async function recordView(
    target: ListingTarget,
    id: string,
    viewerId: string | null,
    ownerId: string,
  ): Promise<void> {
    if (viewerId && viewerId === ownerId) return;
    try {
      await counter(prisma, target).update({
        where: { id },
        data: { viewsCount: { increment: 1 } },
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
