-- CreateEnum
CREATE TYPE "Sentiment" AS ENUM ('POSITIVE', 'NEUTRAL', 'NEGATIVE');

-- CreateEnum
CREATE TYPE "Topic" AS ENUM ('CLEANLINESS', 'CHECK_IN', 'STAFF', 'NOISE', 'FACILITIES', 'LOCATION', 'ROOM_CONDITION', 'VALUE', 'COMFORT', 'WIFI', 'OTHER');

-- CreateEnum
CREATE TYPE "Polarity" AS ENUM ('POSITIVE', 'NEGATIVE');

-- CreateEnum
CREATE TYPE "ClassifierMethod" AS ENUM ('KEYWORD', 'LLM');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'SUCCESS', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL DEFAULT 'au',
    "bookingUrl" TEXT NOT NULL,
    "bookingHotelId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL,
    "stayMonth" TIMESTAMP(3),
    "nights" INTEGER,
    "score" DECIMAL(3,1) NOT NULL,
    "title" TEXT,
    "positiveText" TEXT,
    "negativeText" TEXT,
    "language" TEXT,
    "isTranslated" BOOLEAN NOT NULL DEFAULT false,
    "reviewerName" TEXT,
    "reviewerCountry" TEXT,
    "travellerType" TEXT,
    "roomType" TEXT,
    "propertyResponse" TEXT,
    "helpfulVotes" INTEGER NOT NULL DEFAULT 0,
    "sentiment" "Sentiment" NOT NULL,
    "raw" JSONB NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewTopic" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "topic" "Topic" NOT NULL,
    "polarity" "Polarity" NOT NULL,
    "method" "ClassifierMethod" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "evidence" TEXT,
    "classifierVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PropertySnapshot" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "overallScore" DECIMAL(3,1),
    "reviewCount" INTEGER,
    "subScores" JSONB,

    CONSTRAINT "PropertySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScrapeRun" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "strategy" TEXT NOT NULL,
    "pagesFetched" INTEGER NOT NULL DEFAULT 0,
    "reviewsSeen" INTEGER NOT NULL DEFAULT 0,
    "reviewsNew" INTEGER NOT NULL DEFAULT 0,
    "reviewsUpdated" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,

    CONSTRAINT "ScrapeRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Property_slug_key" ON "Property"("slug");

-- CreateIndex
CREATE INDEX "Review_propertyId_reviewedAt_idx" ON "Review"("propertyId", "reviewedAt");

-- CreateIndex
CREATE INDEX "Review_reviewedAt_idx" ON "Review"("reviewedAt");

-- CreateIndex
CREATE INDEX "Review_sentiment_idx" ON "Review"("sentiment");

-- CreateIndex
CREATE UNIQUE INDEX "Review_propertyId_externalId_key" ON "Review"("propertyId", "externalId");

-- CreateIndex
CREATE INDEX "ReviewTopic_topic_polarity_idx" ON "ReviewTopic"("topic", "polarity");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewTopic_reviewId_topic_polarity_key" ON "ReviewTopic"("reviewId", "topic", "polarity");

-- CreateIndex
CREATE INDEX "PropertySnapshot_propertyId_capturedAt_idx" ON "PropertySnapshot"("propertyId", "capturedAt");

-- CreateIndex
CREATE INDEX "ScrapeRun_propertyId_startedAt_idx" ON "ScrapeRun"("propertyId", "startedAt");

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewTopic" ADD CONSTRAINT "ReviewTopic_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PropertySnapshot" ADD CONSTRAINT "PropertySnapshot_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapeRun" ADD CONSTRAINT "ScrapeRun_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
