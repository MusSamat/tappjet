import type { PrismaClient } from '@prisma/client';
import { Errors } from '@/lib/errors.js';
import { writeAdminAction } from './admin.audit.js';
import type { z } from 'zod';
import type { CityCreateBody, CityUpdateBody } from './admin.schemas.js';

export interface AdminCitiesService {
  list(): Promise<Array<{
    id: number;
    nameRu: string;
    nameKg: string;
    nameEn: string | null;
    regionNameRu: string | null;
    lat: number | null;
    lng: number | null;
    isActive: boolean;
  }>>;
  create(
    input: z.infer<typeof CityCreateBody>,
    adminId: string,
    ip?: string | null,
  ): Promise<{ id: number }>;
  update(
    id: number,
    patch: z.infer<typeof CityUpdateBody>,
    adminId: string,
    ip?: string | null,
  ): Promise<{ id: number }>;
}

export function createAdminCitiesService(prisma: PrismaClient): AdminCitiesService {
  async function list() {
    return prisma.city.findMany({
      orderBy: { nameRu: 'asc' },
      select: { id: true, nameRu: true, nameKg: true, nameEn: true, regionNameRu: true, lat: true, lng: true, isActive: true },
    });
  }

  // City creation is now done via the seed script (scripts/seed-cities.ts).
  // Admin can only toggle isActive on existing cities.
  async function create(
    _input: z.infer<typeof CityCreateBody>,
    _adminId: string,
    _ip?: string | null,
  ): Promise<{ id: number }> {
    throw Errors.conflict('Cities are managed via the seed script. Use the update endpoint to toggle isActive.');
  }

  async function update(
    id: number,
    patch: z.infer<typeof CityUpdateBody>,
    adminId: string,
    ip?: string | null,
  ): Promise<{ id: number }> {
    const existing = await prisma.city.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('City');
    await prisma.city.update({
      where: { id },
      data: {
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      },
    });

    await writeAdminAction(prisma, {
      adminId,
      action: 'update_city',
      targetType: 'city',
      details: { city_id: id, patch },
      ipAddress: ip ?? null,
    });

    return { id };
  }

  return { list, create, update };
}
