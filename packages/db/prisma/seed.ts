import path from "node:path";
import { config } from "dotenv";
import { PROPERTIES } from "@azzurro/shared";
import { createPrismaClient } from "../src/index.js";

config({ path: path.resolve(import.meta.dirname, "../../../.env") });
const prisma = createPrismaClient();

for (const p of PROPERTIES) {
  await prisma.property.upsert({
    where: { slug: p.slug },
    update: { name: p.name, bookingUrl: p.bookingUrl, countryCode: p.countryCode },
    create: { slug: p.slug, name: p.name, bookingUrl: p.bookingUrl, countryCode: p.countryCode },
  });
}
console.log(`Seeded ${PROPERTIES.length} properties`);
await prisma.$disconnect();
