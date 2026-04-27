import type { PrismaClient } from '@prisma/client';
import * as password from '@/lib/bcrypt.js';
import { Errors } from '@/lib/errors.js';
import { writeAdminAction } from './admin.audit.js';

export interface AdminAdminsService {
  list(): Promise<
    Array<{
      id: string;
      email: string;
      name: string;
      role: 'admin' | 'superadmin';
      isActive: boolean;
      totpEnabled: boolean;
      lastLoginAt: Date | null;
      createdAt: Date;
    }>
  >;
  create(
    input: { email: string; name: string; password: string; role: 'admin' | 'superadmin' },
    adminId: string,
    ip?: string | null,
  ): Promise<{ id: string }>;
}

export function createAdminAdminsService(prisma: PrismaClient): AdminAdminsService {
  async function list() {
    const rows = await prisma.admin.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        totpEnabled: true,
        lastLoginAt: true,
        createdAt: true,
      },
    });
    return rows.map((r) => ({ ...r, role: r.role as 'admin' | 'superadmin' }));
  }

  async function create(
    input: { email: string; name: string; password: string; role: 'admin' | 'superadmin' },
    adminId: string,
    ip?: string | null,
  ): Promise<{ id: string }> {
    const email = input.email.toLowerCase();
    const existing = await prisma.admin.findUnique({ where: { email } });
    if (existing) throw Errors.conflict('Admin with this email already exists');

    const created = await prisma.admin.create({
      data: {
        email,
        name: input.name,
        passwordHash: await password.hash(input.password),
        role: input.role,
        mustChangePassword: true, // force change on first login
        isActive: true,
      },
    });

    await writeAdminAction(prisma, {
      adminId,
      action: 'create_admin',
      targetId: created.id,
      targetType: 'admin',
      details: { email, role: input.role },
      ipAddress: ip ?? null,
    });

    return { id: created.id };
  }

  return { list, create };
}
