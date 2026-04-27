-- Fix language check constraint: 'ky' → 'kg' (project uses 'kg' for Kyrgyz)
-- Drop old constraint first (it blocks the UPDATE to 'kg'), then re-add with correct values.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_language_check";
UPDATE "users" SET "language" = 'kg' WHERE "language" = 'ky';
ALTER TABLE "users" ADD CONSTRAINT "users_language_check" CHECK ("language" IN ('ru', 'kg'));
