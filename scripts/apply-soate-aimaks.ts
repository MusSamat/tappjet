/**
 * Applies the SOATE (ГК 002-2009) aiyl-aimak layer onto the cities table.
 *
 * Reads claude/apply_plan.json (produced by claude/build_plan.py from the
 * official classifier PDF) and, per matched settlement:
 *   - upserts a type='aiyl_aimak' row (is_searchable=false) under its raion
 *   - sets the settlement's parent_id to that aiyl-aimak row
 *   - denormalizes aiyl_aimak_name_ru / _kg onto the settlement
 *
 * Idempotent: aiyl-aimak rows are keyed by (type, name_ru, parent_id); re-runs
 * update in place. Villages that SOATE could not resolve are left untouched and
 * reported separately by the Python matcher (claude/unmatched.json).
 *
 * Run:  npx tsx scripts/apply-soate-aimaks.ts
 */
import { PrismaClient } from '@prisma/client';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface Plan {
  villages: { id: number; aa_ru: string }[];
  aimaks: { raion_id: number; aa_ru: string; village_ids: number[] }[];
}

function loadDotEnv(): void {
  if (process.env['DATABASE_URL']) return;
  const envPath = resolve(__dirname, '../.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let val = m[2]!;
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(m[1]! in process.env)) process.env[m[1]!] = val;
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const plan: Plan = JSON.parse(
    readFileSync(resolve(__dirname, '../claude/apply_plan.json'), 'utf-8'),
  );
  const prisma = new PrismaClient();
  try {
    // 1) Upsert aiyl-aimak rows under their raion and link member villages.
    let aaCreated = 0;
    let aaUpdated = 0;
    let linked = 0;
    for (const aa of plan.aimaks) {
      const raion = await prisma.city.findUnique({
        where: { id: aa.raion_id },
        select: { regionNameRu: true, regionNameKg: true, nameRu: true, nameKg: true },
      });
      const existing = await prisma.city.findFirst({
        where: { type: 'aiyl_aimak', nameRu: aa.aa_ru, parentId: aa.raion_id },
        select: { id: true },
      });
      const data = {
        type: 'aiyl_aimak',
        isSearchable: false,
        nameRu: aa.aa_ru,
        nameKg: aa.aa_ru,
        parentId: aa.raion_id,
        regionNameRu: raion?.regionNameRu ?? null,
        regionNameKg: raion?.regionNameKg ?? null,
        districtNameRu: raion?.nameRu ?? null,
        districtNameKg: raion?.nameKg ?? null,
        aiylAimakNameRu: aa.aa_ru,
        aiylAimakNameKg: aa.aa_ru,
      };
      let aaId: number;
      if (existing) {
        await prisma.city.update({ where: { id: existing.id }, data });
        aaId = existing.id;
        aaUpdated++;
      } else {
        const created = await prisma.city.create({
          data: { ...data, priority: 0, isActive: true, prompt: [] },
          select: { id: true },
        });
        aaId = created.id;
        aaCreated++;
      }
      // Reparent member villages under the aiyl-aimak row.
      const r = await prisma.city.updateMany({
        where: { id: { in: aa.village_ids } },
        data: {
          parentId: aaId,
          aiylAimakNameRu: aa.aa_ru,
          aiylAimakNameKg: aa.aa_ru,
        },
      });
      linked += r.count;
    }

    // 2) Denormalize aiyl_aimak name onto every matched village (covers the
    //    76 whose raion row is absent, so they carry the name even without a
    //    tree parent).
    let tagged = 0;
    for (const v of plan.villages) {
      const r = await prisma.city.updateMany({
        where: { id: v.id, aiylAimakNameRu: null },
        data: { aiylAimakNameRu: v.aa_ru, aiylAimakNameKg: v.aa_ru },
      });
      tagged += r.count;
    }

    console.log(`aiyl-aimak rows: ${aaCreated} created, ${aaUpdated} updated`);
    console.log(`villages linked to a tree parent: ${linked}`);
    console.log(`villages denormalized (incl. no-raion-row): ${plan.villages.length} planned, ${tagged} newly tagged`);

    const summary = await prisma.$queryRawUnsafe(
      `SELECT type, count(*)::int n FROM cities GROUP BY type ORDER BY n DESC`,
    );
    console.log(summary);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
