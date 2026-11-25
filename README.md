# Azzurro Hotels — Booking.com Review Insights

Collects public Booking.com guest reviews for four Azzurro Hotels properties and turns them into an
operations dashboard: weekly rating vs last week, per-property breakdown, review feed, sentiment trends
and recurring operational topics (cleanliness, check-in, staff, noise, …).

> 🚧 Work in progress — full setup, architecture and methodology docs will be added here.

## Stack

| Layer | Tech | Hosting (planned) |
|---|---|---|
| Dashboard (`apps/web`) | Next.js 16, Tailwind, Recharts | Vercel |
| API + collector (`apps/api`) | NestJS 12, Playwright, scheduled jobs | Railway / Render (Docker) |
| Database (`packages/db`) | PostgreSQL + Prisma 7 | Neon / Supabase |
| Shared (`packages/shared`) | Property list, topic taxonomy, sentiment rules | — |

## Quick start (local)

```bash
pnpm install
cp .env.example .env            # set DATABASE_URL
pnpm --filter @azzurro/shared build
pnpm --filter @azzurro/db build
pnpm db:migrate && pnpm db:seed
pnpm dev:api                    # http://localhost:4000/health
pnpm dev:web                    # http://localhost:3000
```
