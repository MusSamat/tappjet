import type { PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import { Errors } from '@/lib/errors.js';
import { writeAdminAction } from './admin.audit.js';
import type { CarCatalogService } from '@/modules/cars/carCatalog.service.js';
import type {
  CarBrandCreateBody,
  CarBrandUpdateBody,
  CarColorCreateBody,
  CarColorUpdateBody,
  CarModelCreateBody,
  CarModelUpdateBody,
} from './admin.schemas.js';

/**
 * Admin CRUD for the car catalog (brands · models · colors).
 *
 * These are small manual-PK (SmallInt) reference tables — no autoincrement — so
 * `create` allocates the next id itself (max+1). Every mutation invalidates the
 * public catalog cache so client pickers pick up the change immediately, and is
 * written to the admin audit log.
 *
 * Deletes are hard deletes: existing cars/trips store make/model/color as free
 * text, so removing a catalog row never breaks historical data.
 */
export function createAdminCarCatalogService(prisma: PrismaClient, catalog: CarCatalogService) {
  async function nextBrandId(): Promise<number> {
    const { _max } = await prisma.carBrand.aggregate({ _max: { id: true } });
    return (_max.id ?? 0) + 1;
  }
  async function nextModelId(): Promise<number> {
    const { _max } = await prisma.carModel.aggregate({ _max: { id: true } });
    return (_max.id ?? 0) + 1;
  }
  async function nextColorId(): Promise<number> {
    const { _max } = await prisma.carColor.aggregate({ _max: { id: true } });
    return (_max.id ?? 0) + 1;
  }

  // ─── Brands ──────────────────────────────────────────────────────────
  async function listBrands() {
    return prisma.carBrand.findMany({
      orderBy: { sortPosition: 'asc' },
      select: { id: true, name: true, sortPosition: true, isActive: true },
    });
  }

  async function createBrand(
    input: z.infer<typeof CarBrandCreateBody>,
    adminId: string,
    ip?: string | null,
  ): Promise<{ id: number }> {
    const dup = await prisma.carBrand.findUnique({ where: { name: input.name } });
    if (dup) throw Errors.conflict('A brand with this name already exists');
    const id = await nextBrandId();
    await prisma.carBrand.create({
      data: {
        id,
        name: input.name,
        sortPosition: input.sortPosition ?? id,
        isActive: input.isActive ?? true,
      },
    });
    catalog.invalidate();
    await writeAdminAction(prisma, {
      adminId,
      action: 'create_car_brand',
      targetType: 'car_brand',
      details: { brand_id: id, input },
      ipAddress: ip ?? null,
    });
    return { id };
  }

  async function updateBrand(
    id: number,
    patch: z.infer<typeof CarBrandUpdateBody>,
    adminId: string,
    ip?: string | null,
  ): Promise<{ id: number }> {
    const existing = await prisma.carBrand.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('Car brand');
    if (patch.name && patch.name !== existing.name) {
      const dup = await prisma.carBrand.findUnique({ where: { name: patch.name } });
      if (dup) throw Errors.conflict('A brand with this name already exists');
    }
    await prisma.carBrand.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.sortPosition !== undefined ? { sortPosition: patch.sortPosition } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      },
    });
    catalog.invalidate();
    await writeAdminAction(prisma, {
      adminId,
      action: 'update_car_brand',
      targetType: 'car_brand',
      details: { brand_id: id, patch },
      ipAddress: ip ?? null,
    });
    return { id };
  }

  async function deleteBrand(id: number, adminId: string, ip?: string | null): Promise<{ id: number }> {
    const existing = await prisma.carBrand.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('Car brand');
    // Models cascade via the FK's ON DELETE CASCADE.
    await prisma.carBrand.delete({ where: { id } });
    catalog.invalidate();
    await writeAdminAction(prisma, {
      adminId,
      action: 'delete_car_brand',
      targetType: 'car_brand',
      details: { brand_id: id, name: existing.name },
      ipAddress: ip ?? null,
    });
    return { id };
  }

  // ─── Models ──────────────────────────────────────────────────────────
  async function listModels(brandId?: number) {
    return prisma.carModel.findMany({
      where: brandId !== undefined ? { brandId } : undefined,
      orderBy: [{ brandId: 'asc' }, { sortPosition: 'asc' }],
      select: { id: true, brandId: true, name: true, bodyType: true, sortPosition: true, isActive: true },
    });
  }

  async function createModel(
    input: z.infer<typeof CarModelCreateBody>,
    adminId: string,
    ip?: string | null,
  ): Promise<{ id: number }> {
    const brand = await prisma.carBrand.findUnique({ where: { id: input.brandId } });
    if (!brand) throw Errors.notFound('Car brand');
    const id = await nextModelId();
    await prisma.carModel.create({
      data: {
        id,
        brandId: input.brandId,
        name: input.name,
        bodyType: input.bodyType ?? null,
        sortPosition: input.sortPosition ?? id,
        isActive: input.isActive ?? true,
      },
    });
    catalog.invalidate();
    await writeAdminAction(prisma, {
      adminId,
      action: 'create_car_model',
      targetType: 'car_model',
      details: { model_id: id, input },
      ipAddress: ip ?? null,
    });
    return { id };
  }

  async function updateModel(
    id: number,
    patch: z.infer<typeof CarModelUpdateBody>,
    adminId: string,
    ip?: string | null,
  ): Promise<{ id: number }> {
    const existing = await prisma.carModel.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('Car model');
    if (patch.brandId !== undefined && patch.brandId !== existing.brandId) {
      const brand = await prisma.carBrand.findUnique({ where: { id: patch.brandId } });
      if (!brand) throw Errors.notFound('Car brand');
    }
    await prisma.carModel.update({
      where: { id },
      data: {
        ...(patch.brandId !== undefined ? { brandId: patch.brandId } : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.bodyType !== undefined ? { bodyType: patch.bodyType } : {}),
        ...(patch.sortPosition !== undefined ? { sortPosition: patch.sortPosition } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      },
    });
    catalog.invalidate();
    await writeAdminAction(prisma, {
      adminId,
      action: 'update_car_model',
      targetType: 'car_model',
      details: { model_id: id, patch },
      ipAddress: ip ?? null,
    });
    return { id };
  }

  async function deleteModel(id: number, adminId: string, ip?: string | null): Promise<{ id: number }> {
    const existing = await prisma.carModel.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('Car model');
    await prisma.carModel.delete({ where: { id } });
    catalog.invalidate();
    await writeAdminAction(prisma, {
      adminId,
      action: 'delete_car_model',
      targetType: 'car_model',
      details: { model_id: id, brand_id: existing.brandId, name: existing.name },
      ipAddress: ip ?? null,
    });
    return { id };
  }

  // ─── Colors ──────────────────────────────────────────────────────────
  async function listColors() {
    return prisma.carColor.findMany({
      orderBy: { sortPosition: 'asc' },
      select: { id: true, nameRu: true, nameKy: true, hexCode: true, sortPosition: true, isActive: true },
    });
  }

  async function createColor(
    input: z.infer<typeof CarColorCreateBody>,
    adminId: string,
    ip?: string | null,
  ): Promise<{ id: number }> {
    const id = await nextColorId();
    await prisma.carColor.create({
      data: {
        id,
        nameRu: input.nameRu,
        nameKy: input.nameKy,
        hexCode: input.hexCode,
        sortPosition: input.sortPosition ?? id,
        isActive: input.isActive ?? true,
      },
    });
    catalog.invalidate();
    await writeAdminAction(prisma, {
      adminId,
      action: 'create_car_color',
      targetType: 'car_color',
      details: { color_id: id, input },
      ipAddress: ip ?? null,
    });
    return { id };
  }

  async function updateColor(
    id: number,
    patch: z.infer<typeof CarColorUpdateBody>,
    adminId: string,
    ip?: string | null,
  ): Promise<{ id: number }> {
    const existing = await prisma.carColor.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('Car color');
    await prisma.carColor.update({
      where: { id },
      data: {
        ...(patch.nameRu !== undefined ? { nameRu: patch.nameRu } : {}),
        ...(patch.nameKy !== undefined ? { nameKy: patch.nameKy } : {}),
        ...(patch.hexCode !== undefined ? { hexCode: patch.hexCode } : {}),
        ...(patch.sortPosition !== undefined ? { sortPosition: patch.sortPosition } : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      },
    });
    catalog.invalidate();
    await writeAdminAction(prisma, {
      adminId,
      action: 'update_car_color',
      targetType: 'car_color',
      details: { color_id: id, patch },
      ipAddress: ip ?? null,
    });
    return { id };
  }

  async function deleteColor(id: number, adminId: string, ip?: string | null): Promise<{ id: number }> {
    const existing = await prisma.carColor.findUnique({ where: { id } });
    if (!existing) throw Errors.notFound('Car color');
    await prisma.carColor.delete({ where: { id } });
    catalog.invalidate();
    await writeAdminAction(prisma, {
      adminId,
      action: 'delete_car_color',
      targetType: 'car_color',
      details: { color_id: id, name_ru: existing.nameRu },
      ipAddress: ip ?? null,
    });
    return { id };
  }

  return {
    listBrands,
    createBrand,
    updateBrand,
    deleteBrand,
    listModels,
    createModel,
    updateModel,
    deleteModel,
    listColors,
    createColor,
    updateColor,
    deleteColor,
  };
}
