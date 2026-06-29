/**
 * Seed 624 KG cities from claude/locations.json into the cities table.
 * Run: tsx scripts/seed-cities.ts
 *
 * Uses upsert on nameRu so it's safe to re-run.
 * Cities with district_id === 0 get districtId = null (no district).
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface LocationEntry {
  id: number;
  name_ru: string;
  name_kg: string;
  name_en: string;
  type: string;
  region_id: number;
  region_name_ru: string;
  region_name_kg: string;
  district_id: number;
  district_name_ru: string;
  district_name_kg: string;
  lat: number;
  lng: number;
  prompt: string[];
}

// Major intercity hubs surface first in autocomplete/search (TZ §1.4 + popular
// routes). Keyed by name_ru exactly as it appears in locations.json. The old
// region-based heuristic boosted whole oblasts (so villages outranked Ош, which
// itself scored 0) — replaced with an explicit hub list.
const CITY_PRIORITY: Record<string, number> = {
  Бишкек: 1000,
  Ош: 1000,
  Каракол: 900,
  Нарын: 900,
  Талас: 900,
  Баткен: 900,
  Токмок: 800,
  'Кара-Балта': 800,
  Балыкчы: 800,
  Кант: 800,
  'Кара-Суу': 800,
  Өзгөн: 800,
  'Чолпон-Ата': 800,
  'Кызыл-Кия': 800,
};

function getPriority(entry: LocationEntry): number {
  const explicit = CITY_PRIORITY[entry.name_ru];
  if (explicit !== undefined) return explicit;
  if (entry.type === 'city') return 100;
  return 0;
}

async function main() {
  const prisma = new PrismaClient();

  const raw = readFileSync(resolve(__dirname, '../claude/locations.json'), 'utf-8');
  const locations: LocationEntry[] = JSON.parse(raw) as LocationEntry[];

  console.log(`Seeding ${locations.length} cities…`);

  // Truncate and re-seed so explicit IDs from locations.json never conflict.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE cities RESTART IDENTITY CASCADE`);

  const rows = locations.map((loc) => ({
    id: loc.id,
    nameRu: loc.name_ru,
    nameKg: loc.name_kg,
    nameEn: loc.name_en,
    type: loc.type,
    regionId: loc.region_id,
    regionNameRu: loc.region_name_ru,
    regionNameKg: loc.region_name_kg,
    districtId: loc.district_id === 0 ? null : loc.district_id,
    districtNameRu: loc.district_name_ru || null,
    districtNameKg: loc.district_name_kg || null,
    lat: loc.lat,
    lng: loc.lng,
    prompt: loc.prompt,
    priority: getPriority(loc),
    isActive: true,
  }));

  // createMany is much faster than N individual inserts.
  const result = await prisma.city.createMany({ data: rows, skipDuplicates: true });

  console.log(`Done. Inserted: ${result.count}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
