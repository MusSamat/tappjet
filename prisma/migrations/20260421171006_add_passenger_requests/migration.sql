-- CreateTable
CREATE TABLE "passenger_requests" (
    "id" UUID NOT NULL,
    "passenger_id" UUID NOT NULL,
    "origin_city" VARCHAR(50) NOT NULL,
    "destination_city" VARCHAR(50) NOT NULL,
    "seats_needed" SMALLINT NOT NULL DEFAULT 1,
    "departure_date" TIMESTAMPTZ(6) NOT NULL,
    "flexible" BOOLEAN NOT NULL DEFAULT false,
    "comment" VARCHAR(500),
    "status" VARCHAR(20) NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passenger_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "passenger_requests_status_departure_date_idx" ON "passenger_requests"("status", "departure_date");

-- CreateIndex
CREATE INDEX "passenger_requests_passenger_id_idx" ON "passenger_requests"("passenger_id");

-- CreateIndex
CREATE INDEX "passenger_requests_origin_city_destination_city_status_idx" ON "passenger_requests"("origin_city", "destination_city", "status");

-- AddForeignKey
ALTER TABLE "passenger_requests" ADD CONSTRAINT "passenger_requests_passenger_id_fkey" FOREIGN KEY ("passenger_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
