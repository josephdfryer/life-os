# Build from monorepo root: docker build -f apps/assistant/Dockerfile .
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

RUN npx turbo run build --filter=assistant

# ── runner ────────────────────────────────────────────────────────────────────
FROM node:24-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production PORT=3005 HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

COPY --from=builder --chown=nextjs:nodejs /repo/apps/assistant/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/assistant/.next/static     ./apps/assistant/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/assistant/public            ./apps/assistant/public

USER nextjs
EXPOSE 3005
# server.js lives at apps/assistant/server.js inside the standalone root
CMD ["node", "apps/assistant/server.js"]
