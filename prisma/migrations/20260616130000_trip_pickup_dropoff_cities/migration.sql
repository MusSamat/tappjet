-- Mirror model: separate pickup points (boarding, origin side) and dropoff
-- points (alighting, destination side). Both any region. Pickup matches a
-- from_city search; dropoff matches a to_city search.
ALTER TABLE "trips" DROP COLUMN "stop_cities";
ALTER TABLE "trips" ADD COLUMN "pickup_cities" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "trips" ADD COLUMN "dropoff_cities" TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX "idx_trips_pickup_cities" ON "trips" USING GIN ("pickup_cities");
CREATE INDEX "idx_trips_dropoff_cities" ON "trips" USING GIN ("dropoff_cities");
