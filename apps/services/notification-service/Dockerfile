FROM node:22-alpine AS base
WORKDIR /app
RUN npm install -g pnpm

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ ./packages/
COPY apps/services/notification-service/package.json ./apps/services/notification-service/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY apps/services/notification-service/ ./apps/services/notification-service/
RUN pnpm --filter @vault/logger build
RUN pnpm --filter @vault/types build
RUN pnpm --filter @vault/db build
RUN pnpm --filter @vault/cache build
RUN pnpm --filter @vault/mocks build
RUN pnpm --filter @vault/notification-service build

FROM base AS runner
WORKDIR /app
COPY --from=build /app/apps/services/notification-service/dist ./dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3007
CMD ["node", "dist/index.js"]
