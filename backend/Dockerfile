# ─── Stage 1: Abhängigkeiten installieren ────────────────────────────────────
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# ─── Stage 2: TypeScript kompilieren ─────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY prisma ./prisma
RUN npx prisma generate
RUN npm run build

# ─── Stage 3: Produktions-Image ───────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# OpenSSL installieren – Prisma Schema-Engine benötigt es auf Alpine
RUN apk add --no-cache openssl

# Nur was gebraucht wird
COPY --from=deps  /app/node_modules          ./node_modules
COPY --from=build /app/dist                  ./dist
COPY --from=build /app/node_modules/.prisma  ./node_modules/.prisma
COPY --from=build /app/prisma                ./prisma
COPY package*.json ./

ENV NODE_ENV=production
EXPOSE 3000

# Migrations ausführen, dann Server starten
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
