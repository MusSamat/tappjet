/**
 * One-off cleanup of duplicate accounts created BEFORE the telegramId-capture fix.
 *
 * Background: phone registration delivered the OTP via Telegram (so we knew the
 * user's chat) but never linked telegramId to the account. A later "login via
 * Telegram" therefore created a SECOND, placeholder account. This script finds
 * those pairs and merges the Telegram placeholder INTO the real phone account,
 * moving every owned row (trips, bookings, ratings, likes, responses, driver
 * profile, providers, …) so nothing is orphaned.
 *
 * Matching key: telegram_link_tokens (phone P ↔ telegramId T).
 *   winner = real phone account  (phone = P, telegram_id IS NULL, not a +prov:/+del:)
 *   loser  = Telegram placeholder (telegram_id = T, phone LIKE '+prov:%')
 *
 * Usage:
 *   tsx scripts/dedup-accounts.ts            # DRY RUN — report only, no writes
 *   tsx scripts/dedup-accounts.ts --apply    # perform the merges
 *
 * Safe to re-run: once merged, the loser is soft-deleted and the winner owns the
 * telegramId, so the pair no longer matches.
 */

import { PrismaClient, type Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

interface Pair {
  winnerId: string;
  loserId: string;
  telegramId: bigint;
  phone: string;
}

async function findPairs(): Promise<Pair[]> {
  const tokens = await prisma.telegramLinkToken.findMany({
    where: { telegramId: { not: null } },
    select: { phone: true, telegramId: true },
  });

  const seen = new Set<string>();
  const pairs: Pair[] = [];

  for (const tok of tokens) {
    const telegramId = tok.telegramId!;
    const key = `${tok.phone}|${telegramId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const [winner, loser] = await Promise.all([
      prisma.user.findFirst({
        where: { phone: tok.phone, deletedAt: null, telegramId: null },
        select: { id: true },
      }),
      prisma.user.findFirst({
        where: { telegramId, deletedAt: null, phone: { startsWith: '+prov:' } },
        select: { id: true },
      }),
    ]);

    if (winner && loser && winner.id !== loser.id) {
      pairs.push({ winnerId: winner.id, loserId: loser.id, telegramId, phone: tok.phone });
    }
  }

  // De-dup pairs by winner+loser (a phone may have several link tokens).
  const uniq = new Map<string, Pair>();
  for (const p of pairs) uniq.set(`${p.winnerId}|${p.loserId}`, p);
  return [...uniq.values()];
}

/** Counts of owned rows — printed in the dry-run so the operator can review. */
async function dataFootprint(userId: string) {
  const [trips, bookings, ratingsGiven, ratingsRecv, requests, responses, likes, driver, providers] =
    await Promise.all([
      prisma.trip.count({ where: { driverId: userId } }),
      prisma.booking.count({ where: { passengerId: userId } }),
      prisma.rating.count({ where: { raterId: userId } }),
      prisma.rating.count({ where: { rateeId: userId } }),
      prisma.passengerRequest.count({ where: { passengerId: userId } }),
      prisma.passengerRequestResponse.count({ where: { driverId: userId } }),
      prisma.listingLike.count({ where: { userId } }),
      prisma.driverProfile.count({ where: { userId } }),
      prisma.authProvider.count({ where: { userId } }),
    ]);
  return { trips, bookings, ratingsGiven, ratingsRecv, requests, responses, likes, driver, providers };
}

/**
 * Move rows of a unique-constrained relation from loser→winner, deleting loser
 * rows that would collide with one the winner already has. Pre-computing the
 * conflicts avoids a failed statement aborting the surrounding transaction.
 */
async function moveUnique(
  tx: Prisma.TransactionClient,
  table: 'rating-rater' | 'rating-ratee' | 'response' | 'like',
  loserId: string,
  winnerId: string,
): Promise<{ moved: number; dropped: number }> {
  if (table === 'rating-rater' || table === 'rating-ratee') {
    const fk = table === 'rating-rater' ? 'raterId' : 'rateeId';
    const loserRows = await tx.rating.findMany({ where: { [fk]: loserId } });
    const other = fk === 'raterId' ? 'rateeId' : 'raterId';
    const winnerRows = await tx.rating.findMany({ where: { [fk]: winnerId } });
    const winnerKeys = new Set(
      winnerRows.map((r) => `${r.tripId}|${(r as Record<string, unknown>)[other] as string}`),
    );
    const conflicts = loserRows
      .filter((r) => winnerKeys.has(`${r.tripId}|${(r as Record<string, unknown>)[other] as string}`))
      .map((r) => r.id);
    if (conflicts.length) await tx.rating.deleteMany({ where: { id: { in: conflicts } } });
    await tx.rating.updateMany({ where: { [fk]: loserId }, data: { [fk]: winnerId } });
    return { moved: loserRows.length - conflicts.length, dropped: conflicts.length };
  }

  if (table === 'response') {
    const loserRows = await tx.passengerRequestResponse.findMany({ where: { driverId: loserId } });
    const winnerRows = await tx.passengerRequestResponse.findMany({
      where: { driverId: winnerId },
      select: { requestId: true },
    });
    const winnerKeys = new Set(winnerRows.map((r) => r.requestId));
    const conflicts = loserRows.filter((r) => winnerKeys.has(r.requestId)).map((r) => r.id);
    if (conflicts.length)
      await tx.passengerRequestResponse.deleteMany({ where: { id: { in: conflicts } } });
    await tx.passengerRequestResponse.updateMany({
      where: { driverId: loserId },
      data: { driverId: winnerId },
    });
    return { moved: loserRows.length - conflicts.length, dropped: conflicts.length };
  }

  // table === 'like'
  const loserRows = await tx.listingLike.findMany({ where: { userId: loserId } });
  const winnerRows = await tx.listingLike.findMany({
    where: { userId: winnerId },
    select: { targetType: true, targetId: true },
  });
  const winnerKeys = new Set(winnerRows.map((r) => `${r.targetType}|${r.targetId}`));
  const conflicts = loserRows
    .filter((r) => winnerKeys.has(`${r.targetType}|${r.targetId}`))
    .map((r) => r.id);
  if (conflicts.length) await tx.listingLike.deleteMany({ where: { id: { in: conflicts } } });
  await tx.listingLike.updateMany({ where: { userId: loserId }, data: { userId: winnerId } });
  return { moved: loserRows.length - conflicts.length, dropped: conflicts.length };
}

async function mergePair(pair: Pair): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const now = new Date();
    const winner = await tx.user.findUnique({ where: { id: pair.winnerId } });
    const loser = await tx.user.findUnique({ where: { id: pair.loserId } });
    if (!winner || winner.deletedAt) throw new Error(`winner ${pair.winnerId} gone`);
    if (!loser || loser.deletedAt) throw new Error(`loser ${pair.loserId} gone`);
    if (winner.telegramId !== null && winner.telegramId !== pair.telegramId) {
      throw new Error(`winner ${pair.winnerId} already linked to a different telegramId`);
    }

    // 1) Simple FK moves (no unique constraint involving the user column).
    await tx.trip.updateMany({ where: { driverId: loser.id }, data: { driverId: winner.id } });
    await tx.booking.updateMany({
      where: { passengerId: loser.id },
      data: { passengerId: winner.id },
    });
    await tx.message.updateMany({ where: { senderId: loser.id }, data: { senderId: winner.id } });
    await tx.notification.updateMany({ where: { userId: loser.id }, data: { userId: winner.id } });
    await tx.loyaltyTransaction.updateMany({
      where: { userId: loser.id },
      data: { userId: winner.id },
    });
    await tx.complaint.updateMany({
      where: { reporterId: loser.id },
      data: { reporterId: winner.id },
    });
    await tx.complaint.updateMany({
      where: { targetUserId: loser.id },
      data: { targetUserId: winner.id },
    });
    await tx.passengerRequest.updateMany({
      where: { passengerId: loser.id },
      data: { passengerId: winner.id },
    });
    await tx.telegramBotLoginToken.updateMany({
      where: { userId: loser.id },
      data: { userId: winner.id },
    });

    // 2) Unique-constrained moves (drop colliding loser rows first).
    await moveUnique(tx, 'rating-rater', loser.id, winner.id);
    await moveUnique(tx, 'rating-ratee', loser.id, winner.id);
    await moveUnique(tx, 'response', loser.id, winner.id);
    await moveUnique(tx, 'like', loser.id, winner.id);
    // Self-ratings that appear once both sides are the same user are invalid.
    await tx.$executeRaw`DELETE FROM ratings WHERE rater_id = ${winner.id}::uuid AND ratee_id = ${winner.id}::uuid`;

    // 3) Driver profile (userId is unique → at most one survives).
    const [winnerDp, loserDp] = await Promise.all([
      tx.driverProfile.findUnique({ where: { userId: winner.id } }),
      tx.driverProfile.findUnique({ where: { userId: loser.id } }),
    ]);
    if (loserDp) {
      if (winnerDp) {
        await tx.driverProfile.delete({ where: { userId: loser.id } });
      } else {
        await tx.driverProfile.update({
          where: { userId: loser.id },
          data: { userId: winner.id },
        });
      }
    }

    // 4) Provider links — move those the winner doesn't already have.
    const loserProviders = await tx.authProvider.findMany({ where: { userId: loser.id } });
    for (const link of loserProviders) {
      const clash = await tx.authProvider.findUnique({
        where: {
          provider_providerUserId: {
            provider: link.provider,
            providerUserId: link.providerUserId,
          },
        },
      });
      if (clash && clash.userId !== loser.id) {
        await tx.authProvider.delete({ where: { id: link.id } });
      } else {
        await tx.authProvider.update({ where: { id: link.id }, data: { userId: winner.id } });
      }
    }

    // 5) Identity merge — release the loser's unique fields, then link the winner.
    const tombstone = `+del:${randomUUID().slice(0, 12)}`;
    await tx.user.update({
      where: { id: loser.id },
      data: { deletedAt: now, phone: tombstone, telegramId: null },
    });
    await tx.refreshToken.updateMany({
      where: { userId: loser.id, revokedAt: null },
      data: { revokedAt: now },
    });
    if (winner.telegramId === null) {
      await tx.user.update({ where: { id: winner.id }, data: { telegramId: pair.telegramId } });
    }
    // Carry over the avatar/name if the phone account never set one.
    const winnerData: Prisma.UserUpdateInput = {};
    if (!winner.avatarUrl && loser.avatarUrl) winnerData.avatarUrl = loser.avatarUrl;
    if (Object.keys(winnerData).length) {
      await tx.user.update({ where: { id: winner.id }, data: winnerData });
    }
  });
}

async function main() {
  console.log(`\n🔎 Scanning for duplicate Telegram+phone accounts… (${APPLY ? 'APPLY' : 'DRY RUN'})\n`);
  const pairs = await findPairs();

  if (pairs.length === 0) {
    console.log('✅ No duplicates found. Nothing to do.\n');
    return;
  }

  console.log(`Found ${pairs.length} duplicate pair(s):\n`);
  for (const p of pairs) {
    const [w, l] = await Promise.all([dataFootprint(p.winnerId), dataFootprint(p.loserId)]);
    console.log(`  • phone ${p.phone}  tg ${p.telegramId}`);
    console.log(`      KEEP  ${p.winnerId}  ${JSON.stringify(w)}`);
    console.log(`      MERGE ${p.loserId}  ${JSON.stringify(l)}`);
  }
  console.log('');

  if (!APPLY) {
    console.log('Dry run only. Re-run with --apply to merge.\n');
    return;
  }

  let ok = 0;
  let failed = 0;
  for (const p of pairs) {
    try {
      await mergePair(p);
      ok++;
      console.log(`  ✓ merged ${p.loserId} → ${p.winnerId}`);
    } catch (err) {
      failed++;
      console.error(`  ✗ ${p.loserId} → ${p.winnerId}: ${(err as Error).message}`);
    }
  }
  console.log(`\nDone. Merged ${ok}, failed ${failed}.\n`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
