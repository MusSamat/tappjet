-- TZ §10.1: "Не более одной активной поездки в день на водителя"
-- Partial + expression UNIQUE index — Prisma DSL can't express this.
-- `departure_at::date` truncates the timestamptz to a UTC date, which is what
-- the TZ mandates (we could key on a user-local date, but all times are in
-- UTC per §5.1 "Все timestamps в UTC").
CREATE UNIQUE INDEX "idx_trips_one_active_per_day"
    ON "trips" ("driver_id", ((departure_at AT TIME ZONE 'UTC')::date))
    WHERE "status" = 'active';
