import { Errors } from './errors.js';
import type { PrismaClient } from '@prisma/client';

// Works with both PrismaClient and Prisma transaction clients — any object
// that exposes the `user` model is accepted.
type UserDB = Pick<PrismaClient, 'user'>;

/**
 * Fetch user, assert not soft-deleted and not blocked.
 * Use in every service method that operates on behalf of a known userId.
 * Auth login flows use their own error codes — keep those inline.
 */
export async function assertActiveUser(userId: string, db: UserDB) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) throw Errors.notFound('User');
  if (user.isBlocked) throw Errors.forbidden({ reason: 'blocked' });
  return user;
}
