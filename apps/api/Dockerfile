# API + collector image (Render / Railway / Fly.io). Build from the repo root:
#   docker build -f apps/api/Dockerfile -t azzurro-api .
# Playwright's image ships Chromium and its system libraries; the tag must match the
# installed playwright version (see apps/api/package.json).
FROM mcr.microsoft.com/playwright:v1.65.1-noble AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN npm install -g pnpm@11.22.0
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @azzurro/shared build \
 && pnpm --filter @azzurro/db build \
 && pnpm --filter api build \
 && pnpm deploy --legacy --ignore-scripts --filter api --prod /out

FROM base AS runtime
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build /out ./
# Migrations are applied separately before deploy: `DATABASE_URL=... pnpm db:deploy`.
# The scheduled collector (SCRAPE_CRON) runs inside this process.
CMD ["node", "dist/main.js"]
EXPOSE 4000
