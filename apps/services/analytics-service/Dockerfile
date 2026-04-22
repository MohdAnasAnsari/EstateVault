FROM node:22-alpine AS base
WORKDIR /app
RUN npm install -g pnpm

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ ./packages/
COPY apps/services/analytics-service/package.json ./apps/services/analytics-service/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY apps/services/analytics-service/ ./apps/services/analytics-service/
RUN pnpm --filter @vault/logger build
RUN pnpm --filter @vault/db build
RUN pnpm --filter @vault/cache build
RUN pnpm --filter @vault/ai build
RUN pnpm --filter @vault/analytics-service build

FROM base AS runner
WORKDIR /app
COPY --from=build /app/apps/services/analytics-service/dist ./dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3008
CMD ["node", "dist/index.js"]
