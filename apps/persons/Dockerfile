# Build from monorepo root: docker build -f apps/persons/Dockerfile .
FROM node:24-alpine AS builder
WORKDIR /repo

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json turbo.json ./
COPY apps/persons/package.json       ./apps/persons/
COPY apps/places/package.json        ./apps/places/
COPY apps/assistant/package.json     ./apps/assistant/
COPY apps/home/package.json          ./apps/home/
COPY apps/stuff/package.json         ./apps/stuff/
COPY apps/theory-of/package.json     ./apps/theory-of/
COPY packages/auth/package.json      ./packages/auth/
COPY packages/db/package.json        ./packages/db/
COPY packages/theory/package.json    ./packages/theory/
COPY packages/types/package.json     ./packages/types/
COPY packages/ui/package.json        ./packages/ui/

RUN npm ci

COPY . .

RUN npx turbo run build --filter=persons

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /repo/apps/persons/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/persons/.next/static     ./apps/persons/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/persons/public            ./apps/persons/public

USER nextjs
EXPOSE 3000
CMD ["node", "apps/persons/server.js"]
