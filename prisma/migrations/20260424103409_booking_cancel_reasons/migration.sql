/*
  Warnings:

  - You are about to drop the column `region` on the `cities` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "cancel_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "cities" DROP COLUMN "region",
ALTER COLUMN "name_en" DROP DEFAULT,
ALTER COLUMN "type" DROP DEFAULT,
ALTER COLUMN "region_id" DROP DEFAULT,
ALTER COLUMN "region_name_ru" DROP DEFAULT,
ALTER COLUMN "region_name_ky" DROP DEFAULT,
ALTER COLUMN "prompt" DROP DEFAULT;
