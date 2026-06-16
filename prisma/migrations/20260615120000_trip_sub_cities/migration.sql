-- Trip destination/origin sub-cities (e.g. driver to Баткен also serves Кадамжай).
-- Stored as denormalized, GIN-indexed text[] so search can match a sub-city
-- with Prisma `has` without raw SQL.
ALTER TABLE "trips" ADD COLUMN "origin_sub_cities" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "trips" ADD COLUMN "destination_sub_cities" TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX "idx_trips_origin_sub_cities" ON "trips" USING GIN ("origin_sub_cities");
CREATE INDEX "idx_trips_destination_sub_cities" ON "trips" USING GIN ("destination_sub_cities");
