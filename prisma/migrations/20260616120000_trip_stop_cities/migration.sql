-- Replace the two region-bound sub-city lists with a single "stop cities"
-- list: any city along the trip's route (any region). Searchable on both the
-- origin and destination side so a passenger can board or alight at a stop.
ALTER TABLE "trips" DROP COLUMN "origin_sub_cities";
ALTER TABLE "trips" DROP COLUMN "destination_sub_cities";
ALTER TABLE "trips" ADD COLUMN "stop_cities" TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX "idx_trips_stop_cities" ON "trips" USING GIN ("stop_cities");
