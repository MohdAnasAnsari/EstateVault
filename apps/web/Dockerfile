FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY pnpm-workspace.yaml ./
COPY pnpm-lock.yaml ./
COPY package.json ./
COPY turbo.json ./
COPY packages/types/package.json ./packages/types/
COPY packages/api-client/package.json ./packages/api-client/
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/ui/package.json ./packages/ui/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

FROM deps AS builder
WORKDIR /app

COPY packages/types/ ./packages/types/
COPY packages/api-client/ ./packages/api-client/
COPY packages/crypto/ ./packages/crypto/
COPY packages/ui/ ./packages/ui/
COPY apps/web/ ./apps/web/

ENV NEXT_TELEMETRY_DISABLED=1 BUILD_STANDALONE=true

RUN pnpm install --frozen-lockfile
RUN pnpm turbo build --filter=@vault/web

FROM node:22-alpine AS runner
RUN apk add --no-cache curl dumb-init
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 vault && adduser --system --uid 1001 --ingroup vault vault

COPY --from=builder --chown=vault:vault /app/apps/web/.next/standalone ./
COPY --from=builder --chown=vault:vault /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=vault:vault /app/apps/web/public ./apps/web/public

USER vault

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/web/server.js"]
