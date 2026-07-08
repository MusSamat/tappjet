-- Rule change (agreed 2026-07-08): «one active trip per ROUTE per day» instead
-- of «one active trip per day». The old day-only index blocked the legit
-- «утром туда — вечером обратно» same-day return trip; route+day still kills
-- the spam pattern (3 одинаковых Бишкек→Ош) completely.
--
-- KG is a fixed UTC+6 with no DST.

DROP INDEX IF EXISTS "idx_trips_one_active_per_day";
CREATE UNIQUE INDEX "idx_trips_route_day_unique"
    ON "trips" ("driver_id", "origin_city", "destination_city",
                ((departure_at AT TIME ZONE 'Asia/Bishkek')::date))
    WHERE "status" = 'active';

-- Same rule for passenger requests — the feed clutters just as easily there.
-- Requests never had this constraint, so dedupe first: keep the newest open
-- request per (passenger, route, KG day), cancel the older copies.
UPDATE "passenger_requests" pr SET "status" = 'cancelled'
WHERE pr."status" = 'open'
  AND EXISTS (
    SELECT 1 FROM "passenger_requests" newer
    WHERE newer."status" = 'open'
      AND newer."passenger_id" = pr."passenger_id"
      AND newer."origin_city" = pr."origin_city"
      AND newer."destination_city" = pr."destination_city"
      AND (newer."departure_date" AT TIME ZONE 'Asia/Bishkek')::date
          = (pr."departure_date" AT TIME ZONE 'Asia/Bishkek')::date
      AND newer."created_at" > pr."created_at"
  );

CREATE UNIQUE INDEX "idx_requests_route_day_unique"
    ON "passenger_requests" ("passenger_id", "origin_city", "destination_city",
                             ((departure_date AT TIME ZONE 'Asia/Bishkek')::date))
    WHERE "status" = 'open';
