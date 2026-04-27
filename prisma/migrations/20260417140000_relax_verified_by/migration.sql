-- TZ §5.3 says `verified_by` FKs to users.id, but TZ §6.2 keeps admins in a
-- separate `admins` table — so that FK is unsatisfiable when an admin approves
-- a driver. Drop the FK; keep the column as a plain UUID. Audit trail for who
-- did what is preserved in `admin_actions`.

ALTER TABLE "driver_profiles"
    DROP CONSTRAINT IF EXISTS "driver_profiles_verified_by_fkey";
