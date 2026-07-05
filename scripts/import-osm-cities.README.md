# OSM cities importer

`scripts/import-osm-cities.ts` — populates the `cities` table with **every**
Kyrgyzstan settlement (city / town / village / hamlet) plus the administrative
hierarchy (oblast → raion → aiyl aimak) pulled from OpenStreetMap via the
Overpass API.

It builds a **B-HYBRID** structure:

- a `parent_id` self-tree: `oblast → raion → aiyl_aimak → settlement`
- **denormalized** ancestor names on every settlement row
  (`region_name_ru/kg`, `district_name_ru/kg`, `aiyl_aimak_name_ru/kg`)
  so the existing flat GIN/ILIKE search in `cities.routes.ts` stays fast.

## Order of operations (IMPORTANT)

```
1. scripts/seed-cities.ts      # seeds the 535 hand-tuned rows — TRUNCATEs first
2. scripts/import-osm-cities.ts # merges OSM data ON TOP of those rows
```

**Never run `seed-cities.ts` after the importer** — it `TRUNCATE`s the table and
wipes the whole imported tree. If you must reseed, run seed first, then the
importer again.

## Run

```bash
# DATABASE_URL is read from .env automatically (no dotenv dependency).
npx tsx scripts/import-osm-cities.ts
```

No new npm packages: uses Node 20's built-in global `fetch` and the already
installed `@prisma/client`.

Expect **15–40 min**. The public Overpass API is slow and frequently returns
429 / 504; the script retries with exponential backoff and rotates between the
`overpass.kumi.systems` and `overpass-api.de` mirrors, staying polite
(≥1.3 s between requests). Progress is logged every 20 admin units / 500
settlements.

## Resume after a crash / Ctrl-C

The importer is **fully checkpointed** to `var/osm/` (git-ignored):

| file                | contents                                               |
|---------------------|--------------------------------------------------------|
| `settlements.json`  | raw settlement nodes (fetched once)                    |
| `admin-4/6/8.json`  | raw oblast / raion / aiyl-aimak boundary relations     |
| `membership.json`   | per-unit progress + settlement→admin-unit mappings     |

Just re-run the same command — cached raw data is reused and every admin unit
already marked done in `membership.json` is skipped. The DB writes are
idempotent (upsert on `osm_id`), so re-running never duplicates rows.

To force a **clean re-fetch**, delete `var/osm/` first.

## Merge / dedup with the seeded 535

Before inserting a settlement the importer looks for an existing hand-seeded row
sharing **any normalized name variant** (`name_ru`/`name_kg`/`name_en`/`prompt`
aliases vs OSM `name`/`name:ru`/`name:ky`/`name:en`; lowercase, trimmed, ё→е)
**within ~2 km** (haversine). Variant matching matters: seeds often carry the
Kyrgyz spelling in `name_ru` (Токмок) while OSM's `name:ru` is Russian (Токмак).
On a match it **updates** that row — filling `osm_id`, `parent_id`,
aiyl-aimak names and any missing `name_kg` / `name_en` / `lat` / `lng` — while
**keeping** the row's existing `priority` and `type`. No match → a new row is
inserted. So Бишкек / Ош and the other hubs keep their tuned priorities and are
never duplicated.

## Notes

- Admin boundaries are fetched with the **KG area filter**, so only real
  Kyrgyzstan units come back: 9 at AL4 (7 oblasts + Bishkek + Osh), 57 at AL6
  (raions + oblast-level cities), and only ~4 at AL8 — **aiyl aimak boundaries
  are essentially unmapped in OSM**. Full aiyl-aimak coverage (~440 units)
  needs the official SOATE classifier as a separate source; OSM cannot provide
  it.
- Parenting is **geographic** — OSM has no parent links. For each admin unit the
  script asks Overpass which settlement nodes lie inside it (`map_to_area`), then
  derives admin-unit parentage by majority vote over shared settlements.
- Admin-parent rows are inserted with `is_searchable = false`. The search
  endpoint filters on `is_searchable = true`, so oblast/raion/aiyl-aimak rows
  never pollute autocomplete.
- Settlements that could not be placed in any admin unit get `parent_id = NULL`
  (reported at the end); they still appear in flat search.
```
