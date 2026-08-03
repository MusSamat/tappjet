-- Idempotency-Key replay for POST /bookings (mirrors trips.idempotency_key).
ALTER TABLE "bookings" ADD COLUMN "idempotency_key" VARCHAR(100);
CREATE UNIQUE INDEX "bookings_idempotency_key_key" ON "bookings"("idempotency_key");
