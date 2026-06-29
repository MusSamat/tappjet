-- CreateTable
CREATE TABLE "listing_views" (
    "id" UUID NOT NULL,
    "target_type" VARCHAR(20) NOT NULL,
    "target_id" UUID NOT NULL,
    "viewer_key" VARCHAR(80) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listing_views_target_type_target_id_idx" ON "listing_views"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "listing_views_target_type_target_id_viewer_key_key" ON "listing_views"("target_type", "target_id", "viewer_key");

-- Reset legacy view counters: the previous implementation counted every detail
-- open (inflated, and never fired for passenger requests). Deduped unique-viewer
-- counting starts from a clean slate.
UPDATE "trips" SET "views_count" = 0;
UPDATE "passenger_requests" SET "views_count" = 0;
