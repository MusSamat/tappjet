-- Classical auth: separate surname alongside name (nullable — existing rows keep NULL).
ALTER TABLE "users" ADD COLUMN "surname" VARCHAR(100);
