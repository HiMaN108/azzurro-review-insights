-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "classifiedAt" TIMESTAMP(3),
ADD COLUMN     "classifierVersion" TEXT;

-- CreateIndex
CREATE INDEX "Review_classifiedAt_idx" ON "Review"("classifiedAt");
