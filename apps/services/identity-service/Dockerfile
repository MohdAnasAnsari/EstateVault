FROM node:22-alpine AS base
WORKDIR /app
RUN npm install -g pnpm

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ ./packages/
COPY apps/services/identity-service/package.json ./apps/services/identity-service/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY apps/services/identity-service/ ./apps/services/identity-service/
RUN pnpm --filter @vault/logger build
RUN pnpm --filter @vault/db build
RUN pnpm --filter @vault/cache build
RUN pnpm --filter @vault/crypto build
RUN pnpm --filter @vault/mocks build
RUN pnpm --filter @vault/types build
RUN pnpm --filter @vault/identity-service build

FROM base AS runner
WORKDIR /app
COPY --from=build /app/apps/services/identity-service/dist ./dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3001
CMD ["node", "dist/index.js"]
