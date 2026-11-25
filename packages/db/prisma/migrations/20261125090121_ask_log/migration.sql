-- CreateTable
CREATE TABLE "AskLog" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "answer" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "reviewsUsed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AskLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AskLog_cacheKey_idx" ON "AskLog"("cacheKey");

-- CreateIndex
CREATE INDEX "AskLog_createdAt_idx" ON "AskLog"("createdAt");
