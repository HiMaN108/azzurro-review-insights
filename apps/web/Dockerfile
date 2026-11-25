# Dashboard image (AWS App Runner or any container host). Build from the repo root:
#   docker build -f apps/web/Dockerfile -t azzurro-web .
# Runtime env: API_URL = the API's public URL (read server-side, no rebuild needed).
FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN npm install -g pnpm@11.22.0
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @azzurro/shared build \
 && pnpm --filter web build

FROM base AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app ./
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "start"]
