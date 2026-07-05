-- Partial indexes covering ONLY searchable rows. The trips / passenger_requests
-- tables grow unbounded with completed/cancelled/expired history, but every
-- search filters status='active' / 'open'. Scoping the index to that subset
-- keeps it small no matter how much history accumulates, and it directly serves
-- the (origin, destination, departure) predicate + ordering of the search query.
--
-- Plain CREATE INDEX (not CONCURRENTLY) is safe here: run while the tables are
-- still small, so the brief write lock is negligible. On a large production
-- table, prefer CREATE INDEX CONCURRENTLY (outside a transaction) instead.

CREATE INDEX "idx_trips_active_search"
  ON "trips" ("origin_city", "destination_city", "departure_at")
  WHERE "status" = 'active';

CREATE INDEX "idx_requests_open_search"
  ON "passenger_requests" ("origin_city", "destination_city", "departure_date")
  WHERE "status" = 'open';
