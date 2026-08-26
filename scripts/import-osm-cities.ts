/**
 * Resumable OpenStreetMap → `cities` importer for Kyrgyzstan.
 *
 * Populates every KG settlement (city/town/village/hamlet) plus the admin
 * hierarchy (oblast → raion → aiyl aimak) as a B-HYBRID tree: a `parent_id`
 * self-tree PLUS denormalized ancestor names on each settlement row.
 *
 * Merges with the existing hand-seeded rows (osm_id IS NULL) instead of
 * duplicating them, keeping their tuned `priority`/`type`.
 *
 * Data source: Overpass API. Every network call is rate-limited, retried with
 * exponential backoff + jitter, and checkpointed to JSON under var/osm/ so a
 * crash / Ctrl-C resumes without re-querying completed admin units.
 *
 * Run (loads DATABASE_URL from .env itself):
 *   npx tsx scripts/import-osm-cities.ts
 *
 * MUST run AFTER scripts/seed-cities.ts (which TRUNCATEs). Never re-run
 * seed-cities.ts afterwards — it would wipe the imported tree.
 *
 * Safe to re-run: idempotent upsert on osm_id; membership fetch resumes.
 */

import { PrismaClient } from '@prisma/client';
// HTTP via Node 20's built-in global fetch — no new npm dependency (axios is
// not actually installed in this repo).
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ───────────────────────────────────────────────────────────
const CACHE_DIR = resolve(__dirname, '../var/osm');
const UA = 'terme-geo-import/1.0 (+https://terme.local)';
// Tried in array order among currently-live mirrors (see circuit breaker in
// pickEndpoint). maps.mail.ru is listed first: it answered area-filtered
// relation queries in ~1 s while both classic mirrors were 429/timing out.
const ENDPOINTS = [
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
const MIN_DELAY_MS = 1500; // politeness floor between requests
const REQ_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 6; // per request, then the caller may skip & retry next run
const MERGE_RADIUS_KM = 2; // dedup: same name within this distance = same place

// ─── Types ────────────────────────────────────────────────────────────
type OsmTags = Record<string, string>;
interface OsmNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: OsmTags;
}
interface OsmRelation {
  type: 'relation';
  id: number;
  center?: { lat: number; lon: number };
  tags?: OsmTags;
}
interface OverpassResponse<T> {
  elements: T[];
}

interface Membership {
  // relId of the admin unit each settlement node belongs to
  settlementAiylAimak: Record<string, number>;
  settlementRaion: Record<string, number>;
  settlementOblast: Record<string, number>;
  // rel ids whose membership query already completed (resume markers)
  doneAiylAimak: Record<string, true>;
  doneRaion: Record<string, true>;
  doneOblast: Record<string, true>;
}

// ─── Small utils ──────────────────────────────────────────────────────
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function cachePath(name: string): string {
  return resolve(CACHE_DIR, name);
}

function readJson<T>(name: string): T | null {
  const p = cachePath(name);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf-8')) as T;
}

function writeJson(name: string, data: unknown): void {
  ensureCacheDir();
  const p = cachePath(name);
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  renameSync(tmp, p); // atomic swap so a crash mid-write never corrupts state
}

function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const la1 = (aLat * Math.PI) / 180;
  const la2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(la1) * Math.cos(la2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function normName(s: string): string {
  return s.toLowerCase().trim().replace(/ё/g, 'е');
}

// ─── Overpass client (per-endpoint circuit breaker) ───────────────────
// The public mirrors are flaky: one may be fully down (connection refused /
// timeout) while the other rate-limits (429) or overloads (504). A naive retry
// keeps hammering a dead mirror and wastes a full timeout every request. Each
// endpoint therefore has a `deadUntil` cooldown: on failure we bench it and use
// the other; if all are benched we sleep until the soonest one is free.
interface EndpointState {
  url: string;
  deadUntil: number;
}
const endpoints: EndpointState[] = ENDPOINTS.map((url) => ({ url, deadUntil: 0 }));
let lastRequestAt = 0;
let requestCount = 0;

async function politeWait(): Promise<void> {
  const dt = Date.now() - lastRequestAt;
  if (dt < MIN_DELAY_MS) await sleep(MIN_DELAY_MS - dt);
  lastRequestAt = Date.now();
}

/** Cooldown (ms) to bench an endpoint after a failure. 429 = rate-limit → long. */
function cooldownMs(status: number | null): number {
  if (status === 429) return 60_000; // being throttled — back off hard
  if (status === 504 || status === 503) return 20_000; // overloaded
  return 30_000; // timeout / network / connection refused
}

async function pickEndpoint(): Promise<EndpointState> {
  const now = Date.now();
  const live = endpoints.filter((e) => e.deadUntil <= now);
  if (live.length > 0) return live[0]!;
  // all benched → wait for the soonest to recover
  const soonest = endpoints.reduce((a, b) => (a.deadUntil <= b.deadUntil ? a : b));
  const wait = soonest.deadUntil - now;
  if (wait > 0) {
    process.stdout.write(`\n  … all mirrors benched, waiting ${(wait / 1000).toFixed(0)}s `);
    await sleep(wait);
  }
  return soonest;
}

async function overpass<T>(query: string, label: string): Promise<OverpassResponse<T>> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const ep = await pickEndpoint();
    await politeWait();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), REQ_TIMEOUT_MS);
    try {
      requestCount++;
      const res = await fetch(ep.url, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ data: query }).toString(),
        signal: ac.signal,
      });
      if (res.status === 200) {
        const data = (await res.json()) as OverpassResponse<T>;
        if (data && Array.isArray(data.elements)) return data;
        ep.deadUntil = Date.now() + cooldownMs(null);
      } else if (res.status === 400) {
        const body = await res.text();
        throw new Error(`[${label}] Overpass 400 (bad query): ${body.slice(0, 300)}`);
      } else {
        ep.deadUntil = Date.now() + cooldownMs(res.status);
        process.stdout.write(
          `\n  ! ${label} HTTP ${res.status} on ${hostOf(ep.url)} (attempt ${attempt}/${MAX_ATTEMPTS}) `,
        );
      }
    } catch (err) {
      ep.deadUntil = Date.now() + cooldownMs(null);
      const msg = err instanceof Error ? err.message : String(err);
      process.stdout.write(`\n  ! ${label} ${msg} on ${hostOf(ep.url)} (attempt ${attempt}/${MAX_ATTEMPTS}) `);
    } finally {
      clearTimeout(timer);
    }
    await sleep(500 + Math.floor(Math.random() * 1000));
  }
  throw new Error(`[${label}] gave up after ${MAX_ATTEMPTS} attempts`);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ─── Overpass queries ─────────────────────────────────────────────────
const KG_AREA = 'area["ISO3166-1"="KG"][admin_level=2]->.kg;';

async function fetchSettlements(): Promise<OsmNode[]> {
  const cached = readJson<OsmNode[]>('settlements.json');
  if (cached) {
    console.log(`✓ settlements: ${cached.length} (cached)`);
    return cached;
  }
  const q = `[out:json][timeout:180];
${KG_AREA}
node["place"~"^(city|town|village|hamlet)$"]["name"](area.kg);
out;`;
  console.log('… fetching settlements');
  const data = await overpass<OsmNode>(q, 'settlements');
  const nodes = data.elements.filter((e) => e.type === 'node');
  writeJson('settlements.json', nodes);
  console.log(`✓ settlements: ${nodes.length}`);
  return nodes;
}

async function fetchAdminLevel(level: 4 | 6 | 8): Promise<OsmRelation[]> {
  const file = `admin-${level}.json`;
  const cached = readJson<OsmRelation[]>(file);
  if (cached) {
    console.log(`✓ admin_level=${level}: ${cached.length} (cached)`);
    return cached;
  }
  // Area-filtered: returns ONLY units inside KG (9 oblast-level, 57 raion-level,
  // ~4 AL8 — aiyl aimak boundaries are mostly unmapped in OSM as of 2026).
  const q = `[out:json][timeout:180];
${KG_AREA}
rel["boundary"="administrative"]["admin_level"="${level}"](area.kg);
out tags center;`;
  console.log(`… fetching admin_level=${level}`);
  const data = await overpass<OsmRelation>(q, `admin-${level}`);
  const rels = data.elements.filter((e) => e.type === 'relation');
  writeJson(file, rels);
  console.log(`✓ admin_level=${level}: ${rels.length}`);
  return rels;
}

/** Node ids of settlements geographically inside one admin relation. */
async function fetchMembers(relId: number, label: string): Promise<number[]> {
  const q = `[out:json][timeout:120];
rel(${relId});
map_to_area->.a;
node["place"~"^(city|town|village|hamlet)$"]["name"](area.a);
out ids;`;
  const data = await overpass<{ type: string; id: number }>(q, label);
  return data.elements.filter((e) => e.type === 'node').map((e) => e.id);
}

// ─── Membership derivation (resumable) ────────────────────────────────
function loadMembership(): Membership {
  return (
    readJson<Membership>('membership.json') ?? {
      settlementAiylAimak: {},
      settlementRaion: {},
      settlementOblast: {},
      doneAiylAimak: {},
      doneRaion: {},
      doneOblast: {},
    }
  );
}

async function deriveLevel(
  rels: OsmRelation[],
  m: Membership,
  done: Record<string, true>,
  map: Record<string, number>,
  levelName: string,
  kgIds: Set<number>,
): Promise<void> {
  const pending = rels.filter((r) => !done[String(r.id)]);
  console.log(
    `… ${levelName}: ${rels.length} units, ${pending.length} pending (${rels.length - pending.length} done)`,
  );
  let processed = 0;
  let failed = 0;
  for (const rel of pending) {
    let members: number[];
    try {
      members = await fetchMembers(rel.id, `${levelName}#${rel.id}`);
    } catch (err) {
      // Skip this unit for now — NOT marked done, so a re-run retries it.
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`\n  ⚠ skipping ${levelName}#${rel.id}: ${msg}`);
      continue;
    }
    // Only keep KG settlements — a foreign border unit's area returns that
    // country's nodes, which we must not attribute to this KG import.
    for (const nodeId of members) {
      if (kgIds.has(nodeId)) map[String(nodeId)] = rel.id;
    }
    done[String(rel.id)] = true;
    processed++;
    writeJson('membership.json', m); // checkpoint after EVERY unit
    if (processed % 20 === 0) {
      console.log(
        `  ${levelName}: ${processed}/${pending.length} done · ${Object.keys(map).length} settlements mapped · ${requestCount} reqs total`,
      );
    }
  }
  console.log(
    `✓ ${levelName}: ${processed}/${pending.length} completed this run` +
      (failed > 0 ? `, ${failed} skipped (retry by re-running)` : '') +
      ` · ${Object.keys(map).length} settlements mapped`,
  );
}

// ─── Name helpers ─────────────────────────────────────────────────────
interface Names {
  ru: string;
  kg: string;
  en: string | null;
}

function extractNames(tags: OsmTags | undefined): Names | null {
  if (!tags) return null;
  const base = tags['name'];
  const ru = tags['name:ru'] ?? base;
  const kg = tags['name:ky'] ?? base;
  if (!ru || !kg) return null;
  return { ru, kg, en: tags['name:en'] ?? null };
}

function buildPrompt(tags: OsmTags | undefined, names: Names): string[] {
  const set = new Set<string>();
  for (const v of [tags?.['name'], names.ru, names.kg, names.en]) {
    if (v) set.add(v.toLowerCase().trim());
  }
  return [...set];
}

// ─── DB build ─────────────────────────────────────────────────────────
interface ExistingRow {
  id: number;
  osmId: bigint | null;
  // All normalized name variants (name_ru/kg/en + prompt aliases). Seeds often
  // use the Kyrgyz spelling in name_ru (Токмок) while OSM name:ru is Russian
  // (Токмак) — matching on name_ru alone misses those pairs.
  variants: string[];
  type: string;
  lat: number | null;
  lng: number | null;
  regionNameRu: string | null;
  regionNameKg: string | null;
  districtNameRu: string | null;
  districtNameKg: string | null;
  nameKg: string | null;
  nameEn: string | null;
  claimed: boolean;
}

async function main(): Promise<void> {
  loadDotEnv();
  const started = Date.now();
  ensureCacheDir();
  console.log('=== OSM → cities importer ===');
  console.log(`cache dir: ${CACHE_DIR}`);

  // 1) Raw OSM data (cached after first fetch)
  const settlements = await fetchSettlements();
  const admin4 = await fetchAdminLevel(4);
  const admin6 = await fetchAdminLevel(6);
  const admin8 = await fetchAdminLevel(8);

  // 2) Membership (resumable, the long part)
  const kgIds = new Set(settlements.map((s) => s.id));
  const membership = loadMembership();
  await deriveLevel(admin8, membership, membership.doneAiylAimak, membership.settlementAiylAimak, 'aiyl_aimak(AL8)', kgIds);
  await deriveLevel(admin6, membership, membership.doneRaion, membership.settlementRaion, 'raion(AL6)', kgIds);
  await deriveLevel(admin4, membership, membership.doneOblast, membership.settlementOblast, 'oblast(AL4)', kgIds);

  console.log(`\nOverpass phase done in ${((Date.now() - started) / 1000).toFixed(0)}s, ${requestCount} requests.`);

  // 3) Write to DB
  const prisma = new PrismaClient();
  try {
    await buildDb(prisma, { settlements, admin4, admin6, admin8, membership });
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\n=== DONE in ${((Date.now() - started) / 1000 / 60).toFixed(1)} min ===`);
}

async function buildDb(
  prisma: PrismaClient,
  d: {
    settlements: OsmNode[];
    admin4: OsmRelation[];
    admin6: OsmRelation[];
    admin8: OsmRelation[];
    membership: Membership;
  },
): Promise<void> {
  const { settlements, admin4, admin6, admin8, membership } = d;

  // Name lookups per admin rel id
  const nameOf = new Map<number, Names>();
  for (const rel of [...admin4, ...admin6, ...admin8]) {
    const n = extractNames(rel.tags);
    if (n) nameOf.set(rel.id, n);
  }

  // Derive admin-unit parentage via a representative member settlement.
  // aiyl_aimak → raion / oblast ; raion → oblast (majority vote over members).
  const aaRaion = voteParent(membership.settlementAiylAimak, membership.settlementRaion);
  const aaOblast = voteParent(membership.settlementAiylAimak, membership.settlementOblast);
  const raionOblast = voteParent(membership.settlementRaion, membership.settlementOblast);

  // Only insert admin units that actually contain ≥1 KG settlement (their rel
  // id appears as a value in the settlement→unit map). This drops the foreign
  // border units the bbox fetch pulled in.
  const usedOblast = new Set(Object.values(membership.settlementOblast));
  const usedRaion = new Set(Object.values(membership.settlementRaion));
  const usedAiylAimak = new Set(Object.values(membership.settlementAiylAimak));

  // 3a) Oblasts (AL4) — type=oblast, roots
  console.log('\n… inserting oblasts');
  const oblastDbId = new Map<number, number>();
  for (const rel of admin4) {
    if (!usedOblast.has(rel.id)) continue;
    const names = nameOf.get(rel.id);
    if (!names) continue;
    const id = await upsertAdmin(prisma, rel, 'oblast', names, null, {
      regionNameRu: names.ru,
      regionNameKg: names.kg,
    });
    oblastDbId.set(rel.id, id);
  }
  console.log(`✓ oblasts: ${oblastDbId.size}`);

  // 3b) Raions (AL6) — type=raion, parent=oblast
  console.log('… inserting raions');
  const raionDbId = new Map<number, number>();
  for (const rel of admin6) {
    if (!usedRaion.has(rel.id)) continue;
    const names = nameOf.get(rel.id);
    if (!names) continue;
    const oblastRel = raionOblast.get(rel.id);
    const oblastNames = oblastRel !== undefined ? nameOf.get(oblastRel) : undefined;
    const parentId = oblastRel !== undefined ? oblastDbId.get(oblastRel) ?? null : null;
    const id = await upsertAdmin(prisma, rel, 'raion', names, parentId, {
      regionNameRu: oblastNames?.ru ?? null,
      regionNameKg: oblastNames?.kg ?? null,
      districtNameRu: names.ru,
      districtNameKg: names.kg,
    });
    raionDbId.set(rel.id, id);
  }
  console.log(`✓ raions: ${raionDbId.size}`);

  // 3c) Aiyl aimaks (AL8) — type=aiyl_aimak, parent=raion (or oblast)
  console.log('… inserting aiyl aimaks');
  const aaDbId = new Map<number, number>();
  for (const rel of admin8) {
    if (!usedAiylAimak.has(rel.id)) continue;
    const names = nameOf.get(rel.id);
    if (!names) continue;
    const raionRel = aaRaion.get(rel.id);
    const oblastRel = aaOblast.get(rel.id) ?? (raionRel !== undefined ? raionOblast.get(raionRel) : undefined);
    const oblastNames = oblastRel !== undefined ? nameOf.get(oblastRel) : undefined;
    const raionNames = raionRel !== undefined ? nameOf.get(raionRel) : undefined;
    const parentId =
      (raionRel !== undefined ? raionDbId.get(raionRel) : undefined) ??
      (oblastRel !== undefined ? oblastDbId.get(oblastRel) : undefined) ??
      null;
    const id = await upsertAdmin(prisma, rel, 'aiyl_aimak', names, parentId, {
      regionNameRu: oblastNames?.ru ?? null,
      regionNameKg: oblastNames?.kg ?? null,
      districtNameRu: raionNames?.ru ?? null,
      districtNameKg: raionNames?.kg ?? null,
      aiylAimakNameRu: names.ru,
      aiylAimakNameKg: names.kg,
    });
    aaDbId.set(rel.id, id);
  }
  console.log(`✓ aiyl aimaks: ${aaDbId.size}`);

  // 3d) Load existing rows for merge/dedup
  const existing = await loadExisting(prisma);
  const byOsmId = new Map<string, ExistingRow>();
  const unclaimedByName = new Map<string, ExistingRow[]>();
  for (const r of existing) {
    if (r.osmId !== null) byOsmId.set(r.osmId.toString(), r);
    else {
      for (const v of r.variants) {
        const list = unclaimedByName.get(v) ?? [];
        list.push(r);
        unclaimedByName.set(v, list);
      }
    }
  }

  // 3e) Settlements
  console.log('… inserting/merging settlements');
  let inserted = 0;
  let merged = 0;
  let updated = 0;
  let unparented = 0;
  let processed = 0;

  for (const node of settlements) {
    const names = extractNames(node.tags);
    if (!names) continue;
    const placeType = node.tags?.['place'] ?? 'village';

    const aaRel = membership.settlementAiylAimak[String(node.id)];
    const raionRel =
      membership.settlementRaion[String(node.id)] ??
      (aaRel !== undefined ? aaRaion.get(aaRel) : undefined);
    const oblastRel =
      membership.settlementOblast[String(node.id)] ??
      (aaRel !== undefined ? aaOblast.get(aaRel) : undefined) ??
      (raionRel !== undefined ? raionOblast.get(raionRel) : undefined);

    const parentId =
      (aaRel !== undefined ? aaDbId.get(aaRel) : undefined) ??
      (raionRel !== undefined ? raionDbId.get(raionRel) : undefined) ??
      (oblastRel !== undefined ? oblastDbId.get(oblastRel) : undefined) ??
      null;
    if (parentId === null) unparented++;

    const oblastNames = oblastRel !== undefined ? nameOf.get(oblastRel) : undefined;
    const raionNames = raionRel !== undefined ? nameOf.get(raionRel) : undefined;
    const aaNames = aaRel !== undefined ? nameOf.get(aaRel) : undefined;
    const prompt = buildPrompt(node.tags, names);

    const denorm = {
      parentId,
      regionNameRu: oblastNames?.ru ?? null,
      regionNameKg: oblastNames?.kg ?? null,
      districtNameRu: raionNames?.ru ?? null,
      districtNameKg: raionNames?.kg ?? null,
      aiylAimakNameRu: aaNames?.ru ?? null,
      aiylAimakNameKg: aaNames?.kg ?? null,
    };

    const osmIdStr = String(node.id);

    // (a) already imported → refresh tree + denorm
    const already = byOsmId.get(osmIdStr);
    if (already) {
      await prisma.city.update({
        where: { id: already.id },
        data: {
          parentId: denorm.parentId,
          regionNameRu: already.regionNameRu ?? denorm.regionNameRu,
          regionNameKg: already.regionNameKg ?? denorm.regionNameKg,
          districtNameRu: already.districtNameRu ?? denorm.districtNameRu,
          districtNameKg: already.districtNameKg ?? denorm.districtNameKg,
          aiylAimakNameRu: denorm.aiylAimakNameRu,
          aiylAimakNameKg: denorm.aiylAimakNameKg,
          prompt,
        },
      });
      updated++;
    } else {
      // (b) try to merge into a hand-seeded row: any shared name variant + within radius
      const candidates = new Set<ExistingRow>();
      for (const v of [node.tags?.['name'], names.ru, names.kg, names.en]) {
        if (!v) continue;
        for (const row of unclaimedByName.get(normName(v)) ?? []) candidates.add(row);
      }
      const seed = pickSeedMatch([...candidates], node.lat, node.lon);
      if (seed) {
        seed.claimed = true;
        byOsmId.set(osmIdStr, seed);
        await prisma.city.update({
          where: { id: seed.id },
          data: {
            osmId: BigInt(node.id),
            osmType: 'node',
            parentId: denorm.parentId,
            // keep priority; upgrade type only when the seed undersold a real
            // city/town (several seeds had Бишкек/Ош etc. as 'village')
            type:
              (placeType === 'city' || placeType === 'town') &&
              (seed.type === 'village' || seed.type === 'hamlet')
                ? placeType
                : undefined,
            // fill only what's missing
            nameKg: seed.nameKg && seed.nameKg.length > 0 ? undefined : names.kg,
            nameEn: seed.nameEn ?? names.en ?? undefined,
            regionNameRu: seed.regionNameRu ?? denorm.regionNameRu,
            regionNameKg: seed.regionNameKg ?? denorm.regionNameKg,
            districtNameRu: seed.districtNameRu ?? denorm.districtNameRu,
            districtNameKg: seed.districtNameKg ?? denorm.districtNameKg,
            aiylAimakNameRu: denorm.aiylAimakNameRu,
            aiylAimakNameKg: denorm.aiylAimakNameKg,
            lat: seed.lat ?? node.lat,
            lng: seed.lng ?? node.lon,
            prompt,
          },
        });
        merged++;
      } else {
        // (c) brand new settlement
        await prisma.city.upsert({
          where: { osmId: BigInt(node.id) },
          create: {
            osmId: BigInt(node.id),
            osmType: 'node',
            type: placeType,
            isSearchable: true,
            nameRu: names.ru,
            nameKg: names.kg,
            nameEn: names.en,
            lat: node.lat,
            lng: node.lon,
            prompt,
            priority: placeType === 'city' ? 100 : 0,
            isActive: true,
            ...denorm,
          },
          update: {
            parentId: denorm.parentId,
            aiylAimakNameRu: denorm.aiylAimakNameRu,
            aiylAimakNameKg: denorm.aiylAimakNameKg,
            prompt,
          },
        });
        inserted++;
      }
    }
    processed++;
    if (processed % 500 === 0) console.log(`  settlements: ${processed}/${settlements.length}`);
  }

  console.log(
    `✓ settlements: ${inserted} inserted, ${merged} merged into seeds, ${updated} refreshed, ${unparented} unparented`,
  );
}

/** Majority-vote the parent rel for each child rel, over shared settlement nodes. */
function voteParent(
  childMap: Record<string, number>,
  parentMap: Record<string, number>,
): Map<number, number> {
  const votes = new Map<number, Map<number, number>>();
  for (const [nodeId, childRel] of Object.entries(childMap)) {
    const parentRel = parentMap[nodeId];
    if (parentRel === undefined) continue;
    let m = votes.get(childRel);
    if (!m) {
      m = new Map();
      votes.set(childRel, m);
    }
    m.set(parentRel, (m.get(parentRel) ?? 0) + 1);
  }
  const out = new Map<number, number>();
  for (const [childRel, m] of votes) {
    let best = -1;
    let bestN = -1;
    for (const [parentRel, n] of m) {
      if (n > bestN) {
        bestN = n;
        best = parentRel;
      }
    }
    if (best >= 0) out.set(childRel, best);
  }
  return out;
}

function pickSeedMatch(
  candidates: ExistingRow[] | undefined,
  lat: number,
  lon: number,
): ExistingRow | null {
  if (!candidates) return null;
  let best: ExistingRow | null = null;
  let bestKm = MERGE_RADIUS_KM;
  for (const c of candidates) {
    if (c.claimed || c.lat === null || c.lng === null) continue;
    const km = haversineKm(lat, lon, c.lat, c.lng);
    if (km <= bestKm) {
      bestKm = km;
      best = c;
    }
  }
  return best;
}

async function loadExisting(prisma: PrismaClient): Promise<ExistingRow[]> {
  const rows = await prisma.city.findMany({
    select: {
      id: true,
      osmId: true,
      nameRu: true,
      nameKg: true,
      nameEn: true,
      lat: true,
      lng: true,
      regionNameRu: true,
      regionNameKg: true,
      districtNameRu: true,
      districtNameKg: true,
      prompt: true,
      type: true,
    },
  });
  return rows.map((r) => ({
    id: r.id,
    osmId: r.osmId,
    type: r.type,
    variants: [
      ...new Set(
        [r.nameRu, r.nameKg, r.nameEn, ...r.prompt].filter((v): v is string => !!v).map(normName),
      ),
    ],
    lat: r.lat,
    lng: r.lng,
    regionNameRu: r.regionNameRu,
    regionNameKg: r.regionNameKg,
    districtNameRu: r.districtNameRu,
    districtNameKg: r.districtNameKg,
    nameKg: r.nameKg,
    nameEn: r.nameEn,
    claimed: false,
  }));
}

/** Upsert one admin (oblast/raion/aiyl_aimak) row keyed by negative rel osm_id. */
async function upsertAdmin(
  prisma: PrismaClient,
  rel: OsmRelation,
  type: 'oblast' | 'raion' | 'aiyl_aimak',
  names: Names,
  parentId: number | null,
  denorm: {
    regionNameRu?: string | null;
    regionNameKg?: string | null;
    districtNameRu?: string | null;
    districtNameKg?: string | null;
    aiylAimakNameRu?: string | null;
    aiylAimakNameKg?: string | null;
  },
): Promise<number> {
  // Admin relations stored as NEGATIVE osm_id to guarantee uniqueness vs. node
  // ids (separate OSM id spaces would otherwise be able to collide).
  const osmId = BigInt(-rel.id);
  const prompt = buildPrompt(rel.tags, names);
  const base = {
    osmType: 'relation',
    type,
    isSearchable: false,
    nameRu: names.ru,
    nameKg: names.kg,
    nameEn: names.en,
    parentId,
    lat: rel.center?.lat ?? null,
    lng: rel.center?.lon ?? null,
    prompt,
    ...denorm,
  };
  const row = await prisma.city.upsert({
    where: { osmId },
    create: { osmId, priority: 0, isActive: true, ...base },
    update: base,
    select: { id: true },
  });
  return row.id;
}

// ─── .env loader (no dotenv dep) ──────────────────────────────────────
function loadDotEnv(): void {
  if (process.env['DATABASE_URL']) return;
  const envPath = resolve(__dirname, '../.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    let val = m[2]!;
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

main().catch((e) => {
  console.error('\nFATAL:', e);
  process.exit(1);
});
