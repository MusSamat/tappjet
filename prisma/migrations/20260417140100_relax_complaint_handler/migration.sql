-- Same reasoning as 20260417140000_relax_verified_by: admins live in their
-- own table, so complaints.handled_by (an admin id) cannot FK users.id.
ALTER TABLE "complaints"
    DROP CONSTRAINT IF EXISTS "complaints_handled_by_fkey";
