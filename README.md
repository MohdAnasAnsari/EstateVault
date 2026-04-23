<img width="1894" height="947" alt="Screenshot 2026-04-22 202912" src="https://github.com/user-attachments/assets/59145b5b-46f2-484d-a860-b1d919cb4d29" />
<img width="1907" height="950" alt="Screenshot 2026-04-22 201757" src="https://github.com/user-attachments/assets/8abe93d0-9206-4b4e-9b1e-0f2f7028603c" />
<img width="1910" height="949" alt="Screenshot 2026-04-22 202142" src="https://github.com/user-attachments/assets/936201ae-b38c-447f-acda-a56bc788b9da" />
<img width="1156" height="922" alt="Screenshot 2026-04-22 202315" src="https://github.com/user-attachments/assets/09b4f404-b3fc-4b1e-aa59-710e83a01d75" />
<img width="1176" height="925" alt="Screenshot 2026-04-22 202328" src="https://github.com/user-attachments/assets/66e227be-aa6a-46c8-9954-785f0dcdb3d7" />
<img width="1190" height="778" alt="Screenshot 2026-04-22 202407" src="https://github.com/user-attachments/assets/26110ee8-a072-4947-853c-9088fbd42b72" />
<img width="1272" height="678" alt="Screenshot 2026-04-22 202353" src="https://github.com/user-attachments/assets/eaa6c4db-7747-4e3f-b765-cf46e17cfd03" />
<img width="1218" height="804" alt="Screenshot 2026-04-22 202341" src="https://github.com/user-attachments/assets/6c0976b7-79d2-49fc-a6c6-01c7155fd10e" />
<img width="1215" height="460" alt="Screenshot 2026-04-22 202241" src="https://github.com/user-attachments/assets/54007b2f-db1e-4a35-bf33-1a5e5e46481b" />
<img width="1220" height="479" alt="Screenshot 2026-04-22 202230" src="https://github.com/user-attachments/assets/a928d549-ea91-4740-92f4-428c09232edc" />
<img width="1900" height="939" alt="Screenshot 2026-04-22 202206" src="https://github.com/user-attachments/assets/6581aee5-3d2b-4487-b8a0-566a955084fa" />



# EstateVault (VAULT)

EstateVault is a privacy-first trophy real estate platform for high-value property discovery, verification, and deal execution. The repository contains the full product surface across web, mobile, shared domain packages, a legacy full-stack API, and a newer microservices deployment architecture.

The platform is built around one core idea: buyers, sellers, agents, and admins should be able to discover premium assets, complete compliance checks, collaborate in private deal rooms, and move from interest to offer inside a secure, auditable workflow.

## What The Product Covers

- Private trophy-asset marketplace with role-based access tiers and masked listing visibility.
- Seller onboarding with title deed verification, listing quality scoring, fraud checks, and liveness confirmations.
- Buyer onboarding with multi-step KYC, AML screening, and Level 3 access gating.
- AI-assisted search, matching, listing descriptions, pricing recommendations, comparable sales, translations, concierge help, and market intelligence.
- Encrypted deal rooms with pseudonymous participants, NDA signing, secure file exchange, offers, read receipts, reactions, expiring messages, and AI document analysis.
- Scheduling and communication workflows including meetings, ICS calendar exports, audio/video call support, and real-time messaging.
- Investor workflows such as off-market buyer briefs, portfolio tracking, encrypted notes, AI portfolio insights, and side-by-side comparisons.
- Notification infrastructure for in-app, email, web push, and mobile push delivery.
- Mobile companion app for listings, portfolio, deal rooms, notifications, and settings.
- Docker Compose, Kubernetes, ingress, autoscaling, Redis/BullMQ jobs, Prometheus monitoring, and structured logging.

## Key Features

### 1. Identity, Trust, and Access Control

- Role-aware onboarding for buyers, sellers, agents, and admins.
- Agent registration with mock RERA validation.
- Email verification, OTP flows, phone verification, forgot/reset password flows.
- TOTP-based 2FA with QR code setup and backup codes.
- Brute-force protection and rate limiting on authentication endpoints.
- Multi-step KYC wizard with document upload, selfie/liveness prompt, proof of address, and investment-capacity capture.
- AML screening and admin compliance review queues.
- Tiered access model (`level_1`, `level_2`, `level_3`) that gates sensitive features such as market intelligence and seller workflows.

### 2. Listing Discovery and Seller Workflows

- Trophy asset catalog covering hotels, palaces, development plots, penthouses, villas, private islands, and more.
- Rich listing schema with commercial metrics, seller motivation, verification state, quality tier, and embedded AI vectors.
- Filtered browse experience plus natural-language search interpretation.
- Meilisearch-backed search infrastructure and listing indexing.
- AI-powered listing quality scoring, fraud checks, and price recommendations.
- Dual-language listing description generation (English and Arabic).
- Comparable sales and investment calculator modules on listing detail pages.
- Fuzzed public coordinates to protect exact property location.
- Save/unsave flows, similar listings, view tracking, interest tracking, and seller liveness confirmations.
- Seller listing editor with client-side AES encryption of title deed and compliance documents before upload.

### 3. Private Deal Execution

- Deal room creation directly from listings.
- Pseudonymous participants until trust milestones are met.
- End-to-end encrypted messaging with per-user key material.
- Encrypted file uploads, downloads, watermark text, and AI document analysis.
- NDA workflows with typed or drawn signatures.
- Offer threads and counter-offer handling with encrypted conditions.
- Read receipts, emoji reactions, typing indicators, and optional message expiry.
- AI deal-room assistant suggestions based on room stage and activity.
- Meeting scheduling, availability submission, and ICS export.
- Audio/video call flows with WebRTC signaling support.
- Deal team management for multi-role collaboration.
- Deal-health monitoring for admins.

### 4. Investor and Buyer Intelligence

- AI match feed for buyers with explanations and action controls.
- Off-market buyer brief board with private demand matching.
- Portfolio tracker with kanban stages from saved to won.
- Encrypted portfolio notes and AI-generated portfolio insights.
- Comparison workflow for multiple tracked assets.
- Market intelligence dashboards for Level 3 users covering transaction velocity, price-per-sqm trends, cap rate trackers, buyer-demand heatmaps, and forecast data.
- Investment calculator with mortgage modeling, yields, cash flow, and 5-year projections.

### 5. Communication and Retention

- AI concierge widget for product guidance and support triage.
- In-app notification center with unread counts and preferences.
- Web push subscription endpoints.
- Event-driven notification dispatch for KYC approval, new matches, deal-room activity, NDA signing, offers, and listing liveness warnings.
- Mobile-friendly flows across listings, portfolio, deal rooms, notifications, and settings.

### 6. Operations and Production Readiness

- Shared pnpm + Turborepo monorepo.
- Docker Compose for local infrastructure and containerized services.
- Kubernetes manifests for infrastructure, services, ingress, quotas, autoscaling, and monitoring.
- API gateway with JWT validation, proxy routing, WebSocket forwarding, and observability endpoints.
- Redis-backed BullMQ queues for liveness checks, embeddings, fraud checks, AML, AI matching, and notification processing.
- Pino-based structured logging with secret redaction.
- Sentry hooks across major services.
- Prometheus `ServiceMonitor` and alerting rules.
- k6 load-test scaffold.

## Runtime Modes

This repo currently contains two backend runtime patterns:

### A. Legacy Full-Stack Mode

This is the simplest way to demo the product end to end today.

```text
Next.js web -> apps/api -> Postgres + Redis + Meilisearch + AI/mocks
```

Notes:

- The default `.env.example` points the clients to `http://localhost:4000/api/v1`.
- The web client and mobile client both work naturally with this mode.
- The legacy API already includes the major product workflows listed above.

### B. Microservices / Gateway Mode

This is the decomposed backend architecture used by Docker Compose and Kubernetes.

```text
Client -> api-gateway
       -> identity-service
       -> listing-service
       -> messaging-service
       -> media-service
       -> call-service
       -> ai-service
       -> notification-service
       -> analytics-service
```

Notes:

- `docker-compose.yml`, `Makefile`, and `k8s/` target this architecture.
- The gateway and Next.js web app both default to port `3000`, so if you run them together locally, change one of the ports.

## Monorepo Structure

```text
apps/
  web/                    Next.js 15 web client
  mobile/                 Expo / React Native mobile client
  api/                    Legacy Fastify API + jobs
  services/
    api-gateway/          Reverse proxy + auth boundary
    identity-service/     Auth, users, KYC
    listing-service/      Listings, briefs, portfolio
    messaging-service/    Deal rooms, messages, NDAs, offers, teams
    media-service/        Uploads, encrypted media, presigned URLs
    call-service/         Calls, WebRTC signaling, meetings
    ai-service/           AI endpoints, matching, translation, concierge
    notification-service/ In-app/email/push notification delivery
    analytics-service/    Admin analytics, FX, market intelligence

packages/
  ai/                     OpenAI wrapper + mock-first AI service layer
  api-client/             Shared typed API client
  cache/                  Redis helpers
  crypto/                 libsodium + AES helpers
  db/                     Drizzle schema, migrations, seed data
  logger/                 Pino logging helpers
  mocks/                  Offline third-party mocks
  types/                  Shared Zod schemas and TS types
  ui/                     Shared UI primitives

docker/                   PgBouncer config
k8s/                      Kubernetes manifests
k6/                       Load-test script
scripts/                  Utility scripts
```

## Tech Stack

- Frontend: Next.js 15, React 19, Tailwind CSS 4, Recharts, Socket.IO client
- Mobile: Expo, React Native, React Navigation, SecureStore
- Backend: Fastify 5, JWT, cookies, multipart uploads, Socket.IO
- Data: PostgreSQL 16, Drizzle ORM, pgvector, Redis 7, Meilisearch
- Jobs and events: BullMQ, Redis pub/sub
- AI: OpenAI integration with mock-first fallbacks
- Security: libsodium, AES-GCM, role/tier access control, TOTP 2FA
- Storage and media: Cloudflare R2 compatible media pipeline, Sharp, presigned URLs
- Observability: Pino, Sentry, Prometheus, health/metrics endpoints
- DevOps: pnpm workspaces, Turborepo, Docker Compose, Kubernetes, HPA, Ingress

## Local Setup

### Prerequisites

- Node.js 22+
- pnpm 9+
- Docker Desktop

### 1. Configure environment

```bash
cp .env.example .env
```

Important defaults:

- `MOCK_SERVICES=true` keeps development offline and deterministic.
- `NEXT_PUBLIC_API_URL` and `API_URL` default to the legacy API at `http://localhost:4000/api/v1`.

### 2. Start local infrastructure

```bash
docker compose up -d postgres redis meilisearch
```

### 3. Install dependencies

```bash
pnpm install
```

### 4. Run migrations and seed data

```bash
pnpm --filter @vault/db db:migrate
pnpm --filter @vault/db db:seed
```

### 5. Start the recommended local stack

In two terminals:

```bash
pnpm --filter @vault/api dev
```

```bash
pnpm --filter @vault/web dev
```

Optional mobile client:

```bash
pnpm --filter @vault/mobile start
```

### Local ports in legacy mode

- Web: `http://localhost:3000`
- API: `http://localhost:4000`
- Postgres: `localhost:5432`
- Redis: `localhost:6379`
- Meilisearch: `http://localhost:7700`

## Containerized Service Mesh

To boot the decomposed backend stack:

```bash
make dev-infra
make dev-services
```

Service ports:

- API Gateway: `3000`
- Identity Service: `3001`
- Listing Service: `3002`
- Messaging Service: `3003`
- Media Service: `3004`
- Call Service: `3005`
- AI Service: `3006`
- Notification Service: `3007`
- Analytics Service: `3008`

If you want the web app to call the gateway locally, point `NEXT_PUBLIC_API_URL` to `http://localhost:3000/api/v1` and run the Next.js app on a different port because both default to `3000`.

## Seed Credentials

- Admin: `admin@vault.luxury`
- Seller: `seller@vault.luxury`
- Agent: `agent@vault.luxury`
- Buyer: `buyer@vault.luxury`
- Password: `Vault2024!`

## Deployment Footprint

The repository includes deployment assets for a production-grade backend:

- Kubernetes namespaces for staging and production.
- PostgreSQL with `pgvector`, Redis, and Meilisearch manifests.
- API gateway and service manifests with health checks and autoscaling.
- Nginx ingress with TLS, WebSocket support, rate limits, and security headers.
- Prometheus `ServiceMonitor` and alert rules for availability and resource pressure.

## Development Notes

- The repo is mock-first by default. Many external integrations such as AI, KYC, RERA, exchange rates, SMS, and document analysis fall back to deterministic mocks when `MOCK_SERVICES=true`.
- Sensitive collaboration features are designed around encrypted payloads, pseudonymous identities, and staged disclosure.
- Listing visibility, pricing detail, and analytics access intentionally vary by access tier.

## Helpful Commands

```bash
make help
make dev-infra
make dev-services
make build
make type-check
make lint
make test
make logs service=listing-service
```
