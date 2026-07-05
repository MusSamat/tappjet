-- Two-sided documents: license and tech passport get a back-side photo.
-- Nullable: profiles verified before this change have only the front side.
ALTER TABLE "driver_profiles" ADD COLUMN "license_back_path" VARCHAR(500);
ALTER TABLE "driver_profiles" ADD COLUMN "car_passport_back_path" VARCHAR(500);
