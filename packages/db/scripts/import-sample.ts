/** Load data/sample/reviews.json into an empty/seeded database (alternative to scraping). Idempotent. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { PROPERTIES } from "@azzurro/shared";
import { createPrismaClient } from "../src/index.js";

const root = path.resolve(import.meta.dirname, "../../..");
config({ path: path.join(root, ".env") });
const prisma = createPrismaClient();
const rows = JSON.parse(fs.readFileSync(path.join(root, "data/sample/reviews.json"), "utf8")) as Record<string, any>[];

for (const p of PROPERTIES) {
  await prisma.property.upsert({ where: { slug: p.slug }, update: {}, create: { slug: p.slug, name: p.name, bookingUrl: p.bookingUrl, countryCode: p.countryCode } });
}
const ids = Object.fromEntries((await prisma.property.findMany()).map((p) => [p.slug, p.id]));
// Must match apps/api/src/collector/review.normalizer.ts → contentHash, so later scrapes see no "edit".
const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const hash = (r: Record<string, any>) =>
  createHash("sha1").update([Number(r.score).toFixed(1), norm(r.reviewerName), norm(r.title), norm(r.positiveText), norm(r.negativeText)].join("|")).digest("hex");
const day = (d: string | null) => (d ? new Date(`${d}T00:00:00Z`) : null);

let created = 0;
for (let i = 0; i < rows.length; i += 1000) {
  const batch = rows.slice(i, i + 1000).map((r) => ({
    propertyId: ids[r.property],
    externalId: r.externalId,
    contentHash: hash(r),
    reviewedAt: new Date(r.reviewedAt),
    score: r.score,
    sentiment: r.sentiment,
    title: r.title,
    positiveText: r.positiveText,
    negativeText: r.negativeText,
    language: r.language,
    reviewerName: r.reviewerName,
    reviewerCountry: r.reviewerCountry,
    reviewerCountryCode: r.reviewerCountryCode,
    travellerType: r.travellerType,
    roomType: r.roomType,
    nights: r.nights,
    checkinDate: day(r.checkinDate),
    checkoutDate: day(r.checkoutDate),
    stayMonth: r.checkinDate ? new Date(`${r.checkinDate.slice(0, 7)}-01T00:00:00Z`) : null,
    propertyResponse: r.propertyResponse,
    helpfulVotes: r.helpfulVotes ?? 0,
    source: r.source ?? "graphql",
    raw: {},
  }));
  created += (await prisma.review.createMany({ data: batch, skipDuplicates: true })).count;
}
console.log(`Imported ${created} new reviews (${rows.length - created} already present). Now run: pnpm classify`);
await prisma.$disconnect();
