-- Expand cities table: add multilingual fields, district, prompts, priority.
-- Existing rows (if any) get safe defaults.

ALTER TABLE "cities"
  ADD COLUMN IF NOT EXISTS "name_en"          VARCHAR(150) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "type"             VARCHAR(20)  NOT NULL DEFAULT 'city',
  ADD COLUMN IF NOT EXISTS "region_id"        INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "region_name_ru"   VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "region_name_ky"   VARCHAR(100) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS "district_id"      INTEGER,
  ADD COLUMN IF NOT EXISTS "district_name_ru" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "district_name_ky" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "prompt"           TEXT[]       NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "priority"         INTEGER      NOT NULL DEFAULT 0;

-- Widen existing name columns to match new schema.
ALTER TABLE "cities"
  ALTER COLUMN "name_ru" TYPE VARCHAR(150),
  ALTER COLUMN "name_ky" TYPE VARCHAR(150);

-- Drop autoincrement default so seed can insert explicit IDs from locations.json.
ALTER TABLE "cities" ALTER COLUMN "id" DROP DEFAULT;
DROP SEQUENCE IF EXISTS "cities_id_seq";

-- Index for autocomplete search.
CREATE INDEX IF NOT EXISTS "cities_region_id_idx" ON "cities"("region_id");
CREATE INDEX IF NOT EXISTS "cities_is_active_idx" ON "cities"("is_active");
