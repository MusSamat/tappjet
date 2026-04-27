-- CreateTable
CREATE TABLE "passenger_request_responses" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "driver_id" UUID NOT NULL,
    "price" INTEGER NOT NULL,
    "departure_time" TIMESTAMPTZ(6) NOT NULL,
    "message" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "booking_id" UUID,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passenger_request_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "passenger_request_responses_booking_id_key" ON "passenger_request_responses"("booking_id");

-- CreateIndex
CREATE INDEX "passenger_request_responses_request_id_idx" ON "passenger_request_responses"("request_id");

-- CreateIndex
CREATE INDEX "passenger_request_responses_driver_id_idx" ON "passenger_request_responses"("driver_id");

-- CreateIndex
CREATE INDEX "passenger_request_responses_expires_at_idx" ON "passenger_request_responses"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "passenger_request_responses_request_id_driver_id_key" ON "passenger_request_responses"("request_id", "driver_id");

-- AddForeignKey
ALTER TABLE "passenger_request_responses" ADD CONSTRAINT "passenger_request_responses_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "passenger_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_request_responses" ADD CONSTRAINT "passenger_request_responses_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
