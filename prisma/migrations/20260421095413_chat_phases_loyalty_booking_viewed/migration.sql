-- DropIndex
DROP INDEX "idx_driver_profiles_status_submitted";

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "viewed_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "chat_phase" VARCHAR(20) NOT NULL DEFAULT 'full',
ADD COLUMN     "is_filtered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "original_text" VARCHAR(2000);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "loyalty_points" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "loyalty_tier" VARCHAR(20) NOT NULL DEFAULT 'novice';

-- CreateTable
CREATE TABLE "loyalty_transactions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "points" INTEGER NOT NULL,
    "source" VARCHAR(30) NOT NULL,
    "trip_id" UUID,
    "note" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loyalty_transactions_user_id_idx" ON "loyalty_transactions"("user_id");

-- CreateIndex
CREATE INDEX "loyalty_transactions_created_at_idx" ON "loyalty_transactions"("created_at");

-- AddForeignKey
ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
