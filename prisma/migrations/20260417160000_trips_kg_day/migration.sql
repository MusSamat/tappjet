-- The "one active trip per driver per day" rule (TZ §10.1) should mean a local
-- Kyrgyzstan day, not a UTC day — otherwise a 22:00-local trip and a 02:00-local
-- trip the next night both land on different UTC dates and sneak past the index
-- even though they're adjacent to the same driver's schedule.
--
-- KG is a fixed UTC+6 with no DST.

DROP INDEX IF EXISTS "idx_trips_one_active_per_day";
CREATE UNIQUE INDEX "idx_trips_one_active_per_day"
    ON "trips" ("driver_id", ((departure_at AT TIME ZONE 'Asia/Bishkek')::date))
    WHERE "status" = 'active';
