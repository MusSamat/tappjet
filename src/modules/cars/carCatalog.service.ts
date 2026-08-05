import type { PrismaClient } from '@prisma/client';

/**
 * Car catalog (brands → models) — reference data for the make/model pickers.
 * Tiny + read-heavy, so it's cached in memory. Two fast endpoints:
 *   GET /cars/catalog/brands
 *   GET /cars/catalog/brands/:id/models
 *
 * If the catalog has no matching brand/model, the client falls back to free
 * text — `cars.make` / `cars.model` are plain VARCHARs, so it's saved as-is.
 *
 * Cache is refreshed on a TTL (admin CRUD stays visible within minutes) and can
 * be force-invalidated by the admin layer via `invalidate()`.
 */
export interface BrandDTO {
  id: number;
  name: string;
}
export interface ModelDTO {
  id: number;
  name: string;
  bodyType: string | null;
}
export interface ColorDTO {
  id: number;
  nameRu: string;
  nameKy: string;
  hex: string;
}

const TTL_MS = 10 * 60 * 1000;

export function createCarCatalogService(prisma: PrismaClient) {
  let brands: BrandDTO[] = [];
  let modelsByBrand = new Map<number, ModelDTO[]>();
  let colors: ColorDTO[] = [];
  let loadedAt = 0;
  let loading: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    const [b, m, c] = await Promise.all([
      prisma.carBrand.findMany({
        where: { isActive: true },
        orderBy: { sortPosition: 'asc' },
        select: { id: true, name: true },
      }),
      prisma.carModel.findMany({
        where: { isActive: true },
        orderBy: [{ brandId: 'asc' }, { sortPosition: 'asc' }],
        select: { id: true, brandId: true, name: true, bodyType: true },
      }),
      prisma.carColor.findMany({
        where: { isActive: true },
        orderBy: { sortPosition: 'asc' },
        select: { id: true, nameRu: true, nameKy: true, hexCode: true },
      }),
    ]);
    brands = b;
    const map = new Map<number, ModelDTO[]>();
    for (const row of m) {
      const list = map.get(row.brandId) ?? [];
      list.push({ id: row.id, name: row.name, bodyType: row.bodyType });
      map.set(row.brandId, list);
    }
    modelsByBrand = map;
    colors = c.map((row) => ({ id: row.id, nameRu: row.nameRu, nameKy: row.nameKy, hex: row.hexCode }));
    loadedAt = Date.now();
  }

  async function ensureFresh(): Promise<void> {
    if (Date.now() - loadedAt < TTL_MS && loadedAt !== 0) return;
    // De-dupe concurrent refreshes.
    loading ??= refresh().finally(() => {
      loading = null;
    });
    await loading;
  }

  return {
    async listBrands(): Promise<BrandDTO[]> {
      await ensureFresh();
      return brands;
    },
    async listModels(brandId: number): Promise<ModelDTO[]> {
      await ensureFresh();
      return modelsByBrand.get(brandId) ?? [];
    },
    async listColors(): Promise<ColorDTO[]> {
      await ensureFresh();
      return colors;
    },
    invalidate(): void {
      loadedAt = 0;
    },
  };
}

export type CarCatalogService = ReturnType<typeof createCarCatalogService>;
