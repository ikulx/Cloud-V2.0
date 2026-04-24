# ─── Stage 1: Abhängigkeiten installieren ────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm config set fetch-timeout 600000 && npm config set fetch-retries 5 && npm ci --omit=dev --prefer-offline

# ─── Stage 2: TypeScript kompilieren ─────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm config set fetch-timeout 600000 && npm config set fetch-retries 5 && npm ci --prefer-offline
COPY tsconfig.json ./
COPY tsconfig.seed.json ./
COPY src ./src
COPY prisma ./prisma
RUN npx prisma generate
RUN npm run build
# Seed separat kompilieren (prisma/ liegt ausserhalb von rootDir)
RUN npx tsc -p tsconfig.seed.json

# ─── Stage 3: Produktions-Image ───────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# OpenSSL: Prisma Schema-Engine braucht's auf Alpine.
# postgresql16-client: pg_dump für die Cloud-DB-Backups (siehe
# services/cloud-backup.service.ts). Die Major-Version MUSS zur
# Postgres-Server-Version passen – Alpine liefert hier nur 16, der
# Compose-Stack nutzt Postgres 16 (docker-compose.prod.yml).
RUN apk add --no-cache openssl postgresql16-client

# Nur was gebraucht wird
COPY --from=deps  /app/node_modules              ./node_modules
COPY --from=build /app/dist                      ./dist
COPY --from=build /app/node_modules/.prisma      ./node_modules/.prisma
COPY --from=build /app/prisma                    ./prisma
COPY package*.json ./

ENV NODE_ENV=production
EXPOSE 3000

# Schema synchronisieren, Seed ausführen (upserts = idempotent), dann Server starten
CMD ["sh", "-c", "npx prisma db push --accept-data-loss && node dist/prisma/seed.js && node dist/index.js"]
