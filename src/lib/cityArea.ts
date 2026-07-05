import type { PrismaClient } from '@prisma/client';

/**
 * Expands a city name to all searchable settlement names of the same raion
 * (district) using the cities hierarchy: «Кулунду» → every village of
 * Лейлекский район. Used by the trips / passenger-requests search as a
 * "nearby" fallback tier when the exact city match yields nothing.
 *
 * Returns at least [cityName]. Both nameRu and nameKg resolve the city, but
 * the returned names are canonical nameRu (trips store nameRu strings).
 */
export async function districtCityNames(
  prisma: PrismaClient,
  cityName: string,
): Promise<string[]> {
  const city = await prisma.city.findFirst({
    where: { isActive: true, OR: [{ nameRu: cityName }, { nameKg: cityName }] },
    select: { nameRu: true, districtNameRu: true },
  });
  if (!city?.districtNameRu) return [cityName];
  const rows = await prisma.city.findMany({
    where: {
      isActive: true,
      isSearchable: true,
      districtNameRu: city.districtNameRu,
    },
    select: { nameRu: true },
    take: 300,
  });
  const names = new Set(rows.map((r) => r.nameRu));
  names.add(cityName);
  return [...names];
}
