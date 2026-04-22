FROM node:22-alpine AS base
WORKDIR /app
RUN npm install -g pnpm

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/ ./packages/
COPY apps/services/api-gateway/package.json ./apps/services/api-gateway/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY apps/services/api-gateway/ ./apps/services/api-gateway/
RUN pnpm --filter @vault/logger build
RUN pnpm --filter @vault/api-gateway build

FROM base AS runner
WORKDIR /app
COPY --from=build /app/apps/services/api-gateway/dist ./dist
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/index.js"]
