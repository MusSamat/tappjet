import type { Prisma, PrismaClient } from '@prisma/client';

/**
 * Write an admin_actions row. Every privileged change flows through this —
 * even seemingly trivial ones — so TZ §17 "Аудит-логи" has a complete record.
 *
 * Never throws: audit is a best-effort log, not a gate on the action. If the
 * DB write fails for any reason, we still let the caller proceed (errors are
 * already logged by Prisma's event handlers).
 */
export async function writeAdminAction(
  prisma: PrismaClient,
  input: {
    adminId: string;
    action: string;              // e.g. 'verify_driver', 'block_user'
    targetId?: string | null;
    targetType?: 'user' | 'driver' | 'trip' | 'complaint' | 'city' | 'admin' | null;
    details?: Record<string, unknown>;
    ipAddress?: string | null;
  },
): Promise<void> {
  try {
    await prisma.adminAction.create({
      data: {
        adminId: input.adminId,
        action: input.action,
        targetId: input.targetId ?? null,
        targetType: input.targetType ?? null,
        // Prisma expects InputJsonValue — our Record is assignable at runtime,
        // the declared type narrowing just needs a cast.
        details: (input.details ?? undefined) as Prisma.InputJsonValue | undefined,
        ipAddress: input.ipAddress ?? null,
      },
    });
  } catch {
    // Intentionally swallowed — see comment above.
  }
}
