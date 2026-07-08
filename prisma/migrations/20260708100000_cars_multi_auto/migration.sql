-- Phase 1 (publish without verification): user-owned cars, many per user.
-- Verification stays on driver_profiles as an optional badge only.
CREATE TABLE "cars" (
  "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id"     UUID NOT NULL,
  "make"        VARCHAR(50) NOT NULL,
  "model"       VARCHAR(50) NOT NULL,
  "color"       VARCHAR(30),
  "plate"       VARCHAR(15) NOT NULL,
  "seats_count" SMALLINT NOT NULL DEFAULT 4,
  "created_at"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deleted_at"  TIMESTAMPTZ,
  CONSTRAINT "cars_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "cars_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "cars_user_id_idx" ON "cars"("user_id");

ALTER TABLE "trips" ADD COLUMN "car_id" UUID;
ALTER TABLE "trips" ADD CONSTRAINT "trips_car_id_fkey"
  FOREIGN KEY ("car_id") REFERENCES "cars"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: every existing driver profile becomes the user's first car, so
-- current drivers keep publishing without re-entering their vehicle.
INSERT INTO "cars" ("user_id", "make", "model", "color", "plate", "seats_count")
SELECT "user_id", "car_make", "car_model", "car_color", "car_plate", "seats_count"
FROM "driver_profiles";
