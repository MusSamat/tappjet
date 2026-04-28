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

// Cities with region_id <= 2 or Bishkek/Osh cities get higher priority in search results.
const HIGH_PRIORITY_REGION_IDS = new Set([7, 8]); // Bishkek, Osh
const MID_PRIORITY_REGION_IDS = new Set([1, 2]);  // Chuy, Issyk-Kul

function getPriority(entry: LocationEntry): number {
  if (HIGH_PRIORITY_REGION_IDS.has(entry.region_id)) return 100;
  if (MID_PRIORITY_REGION_IDS.has(entry.region_id)) return 50;
  if (entry.type === 'city') return 30;
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
