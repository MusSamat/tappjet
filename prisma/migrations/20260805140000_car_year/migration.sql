-- Car manufacture year (optional). Powers the verification year field so a
-- saved car pre-fills it. Nullable — existing cars have no stored year.
ALTER TABLE "cars" ADD COLUMN "year" SMALLINT;
