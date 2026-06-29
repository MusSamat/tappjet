-- AlterTable
ALTER TABLE "trips" ADD COLUMN "views_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "likes_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "passenger_requests" ADD COLUMN "views_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "likes_count" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "listing_likes" (
    "id" UUID NOT NULL,
    "target_type" VARCHAR(20) NOT NULL,
    "target_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_likes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listing_likes_target_type_target_id_idx" ON "listing_likes"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "listing_likes_user_id_idx" ON "listing_likes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "listing_likes_target_type_target_id_user_id_key" ON "listing_likes"("target_type", "target_id", "user_id");

-- AddForeignKey
ALTER TABLE "listing_likes" ADD CONSTRAINT "listing_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
