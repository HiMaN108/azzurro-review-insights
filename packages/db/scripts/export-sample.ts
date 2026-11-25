/** Export collected reviews to data/sample (JSON for re-import, CSV for humans). Raw payloads excluded. */
import fs from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createPrismaClient } from "../src/index.js";

const root = path.resolve(import.meta.dirname, "../../..");
config({ path: path.join(root, ".env") });
const prisma = createPrismaClient();
const out = path.join(root, "data/sample");
fs.mkdirSync(out, { recursive: true });

const reviews = await prisma.review.findMany({
  orderBy: [{ reviewedAt: "desc" }, { id: "asc" }],
  include: { property: { select: { slug: true, name: true } }, topics: { select: { topic: true, polarity: true, evidence: true } } },
});

const rows = reviews.map((r) => ({
  property: r.property.slug,
  propertyName: r.property.name,
  externalId: r.externalId,
  reviewedAt: r.reviewedAt.toISOString(),
  score: Number(r.score),
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
  checkinDate: r.checkinDate?.toISOString().slice(0, 10) ?? null,
  checkoutDate: r.checkoutDate?.toISOString().slice(0, 10) ?? null,
  propertyResponse: r.propertyResponse,
  helpfulVotes: r.helpfulVotes,
  source: r.source,
  taggedBy: r.classifierVersion?.startsWith("llm") ? r.classifierVersion.split(":").slice(1).join(":") : "keywords",
  urgent: r.urgent,
  urgentReason: r.urgentReason,
  topics: r.topics.map((t) => `${t.topic}:${t.polarity}`),
}));

fs.writeFileSync(path.join(out, "reviews.json"), JSON.stringify(rows));
const cols = ["property", "propertyName", "externalId", "reviewedAt", "score", "sentiment", "title", "positiveText", "negativeText", "language", "reviewerName", "reviewerCountry", "travellerType", "roomType", "nights", "checkinDate", "propertyResponse", "taggedBy", "urgent", "urgentReason", "topics"] as const;
const esc = (v: unknown) => {
  const s = Array.isArray(v) ? v.join("|") : v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
fs.writeFileSync(path.join(out, "reviews.csv"), [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n"));
console.log(`Exported ${rows.length} reviews to ${path.relative(root, out)}`);
await prisma.$disconnect();
