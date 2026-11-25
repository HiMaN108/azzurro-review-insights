/*
  Warnings:

  - Added the required column `source` to the `Review` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "checkinDate" DATE,
ADD COLUMN     "checkoutDate" DATE,
ADD COLUMN     "reviewerCountryCode" TEXT,
ADD COLUMN     "source" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "Review_propertyId_contentHash_idx" ON "Review"("propertyId", "contentHash");
