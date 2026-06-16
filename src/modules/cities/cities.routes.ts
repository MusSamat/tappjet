import { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import { asyncHandler } from '@/middleware/errorHandler.js';

/**
 * Public city directory — used by client autocompletes.
 * TZ §19.2 Utility: "GET /cities · Список активных городов КГ · Нет (Auth)".
 *
 * GET /cities?q=биш&limit=10  → autocomplete (max 20)
 * GET /cities                 → full list (max 1000)
 * GET /cities/popular-routes  → static popular KG routes
 */

interface CityRow {
  id: number;
  name_ru: string;
  name_ky: string;
  name_en: string;
  region_name_ru: string;
  region_name_ky: string;
  district_name_ru: string | null;
  district_name_ky: string | null;
  lat: number | null;
  lng: number | null;
}

function toDto(r: CityRow) {
  return {
    id: r.id,
    nameRu: r.name_ru,
    nameKg: r.name_ky,
    nameEn: r.name_en,
    regionNameRu: r.region_name_ru,
    regionNameKg: r.region_name_ky,
    districtNameRu: r.district_name_ru ?? null,
    districtNameKg: r.district_name_ky ?? null,
    lat: r.lat,
    lng: r.lng,
  };
}

// Popular intercity routes for Kyrgyzstan (from/to city names must match name_ru in DB).
const POPULAR_ROUTES = [
  { from: 'Бишкек', to: 'Ош' },
  { from: 'Ош', to: 'Бишкек' },
  { from: 'Бишкек', to: 'Каракол' },
  { from: 'Бишкек', to: 'Нарын' },
  { from: 'Бишкек', to: 'Жалал-Абад' },
  { from: 'Ош', to: 'Жалал-Абад' },
  { from: 'Бишкек', to: 'Талас' },
  { from: 'Бишкек', to: 'Балыкчы' },
  { from: 'Ош', to: 'Баткен' },
  { from: 'Бишкек', to: 'Токмок' },
  { from: 'Бишкек', to: 'Кант' },
  { from: 'Ош', to: 'Кара-Суу' },
];

export function createCitiesRouter(prisma: PrismaClient): Router {
  const router = Router();

  // Popular routes with live trip counts — defined before '/' to avoid param conflict.
  router.get(
    '/popular-routes',
    asyncHandler(async (_req, res) => {
      // Count active trips for each predefined route in a single query.
      interface CountRow { from_city: string; to_city: string; trip_count: bigint; min_price: bigint | null }
      const routePairs = POPULAR_ROUTES.map((r) => `('${r.from}','${r.to}')`).join(',');
      const rows = await prisma.$queryRawUnsafe<CountRow[]>(`
        SELECT origin_city AS from_city, destination_city AS to_city,
               COUNT(*) AS trip_count, MIN(price_per_seat) AS min_price
        FROM trips
        WHERE status = 'active'
          AND departure_at > NOW()
          AND (origin_city, destination_city) IN (${routePairs})
        GROUP BY origin_city, destination_city
      `);

      const counts = new Map(rows.map((r) => [`${r.from_city}|${r.to_city}`, { count: Number(r.trip_count), minPrice: r.min_price ? Number(r.min_price) : null }]));

      const data = POPULAR_ROUTES.map((r) => {
        const stats = counts.get(`${r.from}|${r.to}`) ?? { count: 0, minPrice: null };
        return { from: r.from, to: r.to, tripCount: stats.count, minPrice: stats.minPrice };
      });

      res.json({ data });
    }),
  );

  // Sub-cities pickable for a chosen city: other active cities in the same
  // region. Powers the "driver picks Баткен → choose Кадамжай, Исфана…" flow.
  // Defined before '/' so '/:id/sub-cities' is matched as a literal sub-path.
  router.get(
    '/:id/sub-cities',
    asyncHandler(async (req, res) => {
      const id = parseInt(String(req.params['id']), 10);
      if (isNaN(id)) {
        res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'invalid city id' } });
        return;
      }
      const city = await prisma.city.findUnique({
        where: { id },
        select: { regionId: true, isActive: true },
      });
      if (!city || !city.isActive) {
        res.status(404).json({ error: { code: 'NOT_FOUND', message: 'city not found' } });
        return;
      }
      // Optional `q` filters within the region — powers the driver's
      // self-select autocomplete for sub-cities.
      const q = typeof req.query['q'] === 'string' ? req.query['q'].trim() : '';
      const rows = await prisma.city.findMany({
        where: {
          regionId: city.regionId,
          isActive: true,
          id: { not: id },
          ...(q
            ? {
                OR: [
                  { nameRu: { contains: q, mode: 'insensitive' as const } },
                  { nameKg: { contains: q, mode: 'insensitive' as const } },
                  { nameEn: { contains: q, mode: 'insensitive' as const } },
                ],
              }
            : {}),
        },
        orderBy: [{ priority: 'desc' }, { nameRu: 'asc' }],
        take: 12,
        select: {
          id: true,
          nameRu: true,
          nameKg: true,
          nameEn: true,
          regionNameRu: true,
          regionNameKg: true,
          districtNameRu: true,
          districtNameKg: true,
          lat: true,
          lng: true,
        },
      });
      const data = rows.map((r) =>
        toDto({
          id: r.id,
          name_ru: r.nameRu,
          name_ky: r.nameKg,
          name_en: r.nameEn,
          region_name_ru: r.regionNameRu,
          region_name_ky: r.regionNameKg,
          district_name_ru: r.districtNameRu,
          district_name_ky: r.districtNameKg,
          lat: r.lat,
          lng: r.lng,
        }),
      );
      res.json({ data });
    }),
  );

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const q = typeof req.query['q'] === 'string' ? req.query['q'].trim() : '';
      const limitRaw = parseInt(String(req.query['limit'] ?? ''), 10);
      const limit = q
        ? Math.min(isNaN(limitRaw) ? 10 : limitRaw, 20)
        : Math.min(isNaN(limitRaw) ? 1000 : limitRaw, 1000);

      if (q) {
        // Use raw SQL so we can do ILIKE on both scalar columns AND array elements
        // (Prisma's `has` only does exact element match, not substring search).
        const pattern = `%${q}%`;
        const rows = await prisma.$queryRaw<CityRow[]>`
          SELECT id, name_ru, name_ky, name_en,
                 region_name_ru, region_name_ky,
                 district_name_ru, district_name_ky,
                 lat, lng
          FROM cities
          WHERE is_active = true
            AND (
              name_ru   ILIKE ${pattern}
              OR name_ky  ILIKE ${pattern}
              OR name_en  ILIKE ${pattern}
              OR EXISTS (
                SELECT 1 FROM unnest(prompt) AS p
                WHERE p ILIKE ${pattern}
              )
            )
          ORDER BY priority DESC, name_ru ASC
          LIMIT ${limit}
        `;
        res.json({ data: rows.map(toDto) });
      } else {
        const rows = await prisma.$queryRaw<CityRow[]>`
          SELECT id, name_ru, name_ky, name_en,
                 region_name_ru, region_name_ky,
                 district_name_ru, district_name_ky,
                 lat, lng
          FROM cities
          WHERE is_active = true
          ORDER BY priority DESC, name_ru ASC
          LIMIT ${limit}
        `;
        res.json({ data: rows.map(toDto) });
      }
    }),
  );

  return router;
}
