-- Rename Kyrgyz columns  ky -> kg  (RENAME preserves the 535 existing values)
ALTER TABLE "cities" RENAME COLUMN "name_ky"          TO "name_kg";
ALTER TABLE "cities" RENAME COLUMN "region_name_ky"   TO "region_name_kg";
ALTER TABLE "cities" RENAME COLUMN "district_name_ky" TO "district_name_kg";

-- Villages share names → drop the unique-on-name_ru
DROP INDEX IF EXISTS "cities_name_ru_key";

-- id -> autoincrement (attach sequence, seed it past current max so the 535 keep their ids)
CREATE SEQUENCE IF NOT EXISTS "cities_id_seq" OWNED BY "cities"."id";
SELECT setval('cities_id_seq', COALESCE((SELECT MAX(id) FROM "cities"), 1));
ALTER TABLE "cities" ALTER COLUMN "id" SET DEFAULT nextval('cities_id_seq');

-- Relax NOT NULL on fields that OSM / admin-parent rows may lack
ALTER TABLE "cities" ALTER COLUMN "name_en"        DROP NOT NULL;
ALTER TABLE "cities" ALTER COLUMN "region_id"      DROP NOT NULL;
ALTER TABLE "cities" ALTER COLUMN "region_name_ru" DROP NOT NULL;
ALTER TABLE "cities" ALTER COLUMN "region_name_kg" DROP NOT NULL;

-- New OSM + hierarchy columns
ALTER TABLE "cities"
  ADD COLUMN "osm_id"             BIGINT,
  ADD COLUMN "osm_type"           VARCHAR(10),
  ADD COLUMN "parent_id"          INTEGER,
  ADD COLUMN "is_searchable"      BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "aiyl_aimak_name_ru" VARCHAR(100),
  ADD COLUMN "aiyl_aimak_name_kg" VARCHAR(100);

-- Self-referential parent tree
ALTER TABLE "cities"
  ADD CONSTRAINT "cities_parent_id_fkey"
  FOREIGN KEY ("parent_id") REFERENCES "cities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE UNIQUE INDEX "cities_osm_id_key"       ON "cities"("osm_id");
CREATE INDEX        "cities_parent_id_idx"    ON "cities"("parent_id");
CREATE INDEX        "cities_type_idx"         ON "cities"("type");
CREATE INDEX        "cities_is_searchable_idx" ON "cities"("is_searchable");
