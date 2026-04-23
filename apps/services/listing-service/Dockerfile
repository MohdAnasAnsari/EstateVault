FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat python3 make g++
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package.json ./
COPY turbo.json ./
COPY packages/types/package.json ./packages/types/
COPY packages/db/package.json ./packages/db/
COPY packages/cache/package.json ./packages/cache/
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/ai/package.json ./packages/ai/
COPY packages/mocks/package.json ./packages/mocks/
COPY packages/logger/package.json ./packages/logger/
COPY apps/services/listing-service/package.json ./apps/services/listing-service/

RUN pnpm install --frozen-lockfile

FROM deps AS builder
WORKDIR /app

COPY packages/ ./packages/
COPY apps/services/listing-service/ ./apps/services/listing-service/

RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter=@vault/listing-service

FROM node:22-alpine AS runner
RUN apk add --no-cache curl dumb-init
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 vault && adduser --system --uid 1001 --ingroup vault vault
USER vault

COPY --from=builder --chown=vault:vault /app/apps/services/listing-service/dist ./dist
COPY --from=builder --chown=vault:vault /app/node_modules ./node_modules
COPY --from=builder --chown=vault:vault /app/packages ./packages

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:${PORT:-3002}/health || exit 1

EXPOSE 3002

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
