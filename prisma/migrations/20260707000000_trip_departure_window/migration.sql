-- Departure window end («выезд 06:00–11:00»). NULL = exact departure time.
ALTER TABLE "trips" ADD COLUMN "departure_window_end" TIMESTAMPTZ;
