-- Add 'direct' to trips.status CHECK constraint.
-- 'direct' trips are created via passenger request responses —
-- private arrangements that bypass the one-active-per-day uniqueness rule.

ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_status_check;

ALTER TABLE trips ADD CONSTRAINT trips_status_check
  CHECK (status IN ('active', 'completed', 'cancelled', 'direct'));