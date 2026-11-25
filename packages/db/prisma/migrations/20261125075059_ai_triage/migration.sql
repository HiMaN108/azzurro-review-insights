-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "aiCheckedAt" TIMESTAMP(3),
ADD COLUMN     "urgent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "urgentReason" TEXT;

-- CreateIndex
CREATE INDEX "Review_aiCheckedAt_idx" ON "Review"("aiCheckedAt");

-- CreateIndex
CREATE INDEX "Review_urgent_reviewedAt_idx" ON "Review"("urgent", "reviewedAt");
