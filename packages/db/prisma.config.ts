import path from "node:path";
import { config } from "dotenv";
import { defineConfig } from "prisma/config";

// Single .env at the repo root is shared by all apps.
config({ path: path.resolve(import.meta.dirname, "../../.env") });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
  datasource: { url: process.env.DATABASE_URL! },
});
