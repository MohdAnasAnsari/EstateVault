# VAULT

VAULT is a privacy-first trophy real estate platform built as a pnpm monorepo. The platform covers the full Phase 1–3 stack: Fastify API, Next.js web app, Drizzle schema, mocks-first AI/service integrations, seed data, encryption helpers, daily listing liveness jobs, KYC wizard with AML/RERA compliance, AI quality scoring, fraud detection, and encrypted deal rooms with NDA signing and offers.

## Prerequisites

- Node.js 22 LTS
- pnpm 9+
- Docker Desktop or a local PostgreSQL 16 + Redis 7 + Meilisearch instance

## Dev Setup

1. Copy `.env.example` to `.env`.
2. Start infrastructure with `docker compose up -d`.
3. Install dependencies with `pnpm install`.
4. Generate and run migrations:
   - `pnpm db:generate`
   - `pnpm db:migrate`
5. Seed sample data with `pnpm db:seed`.
6. Start the monorepo with `pnpm dev`.

Expected local ports:

- Web: `http://localhost:3000`
- API: `http://localhost:4000`
- Postgres: `localhost:5432`
- Redis: `localhost:6379`
- Meilisearch: `http://localhost:7700`

## Seed Credentials

- Admin: `admin@vault.luxury`
- Seller: `seller@vault.luxury`
- Agent: `agent@vault.luxury`
- Buyer: `buyer@vault.luxury`
- Password: `Vault2024!`

## Architecture

```text
vault/
├─ apps/
│  ├─ web        Next.js 15 app router UI
│  └─ api        Fastify 5 REST API + BullMQ jobs
├─ packages/
│  ├─ ai         AIService wrapper with mock-first behavior
│  ├─ api-client Typed fetch client for frontend consumers
│  ├─ cache      Redis helpers
│  ├─ crypto     libsodium utilities
│  ├─ db         Drizzle schema, client, migration, seed
│  ├─ mocks      Mock third-party implementations
│  ├─ types      Shared Zod schemas and TypeScript types
│  └─ ui         Shared React UI primitives
└─ docker-compose.yml
```

Runtime flow:

```text
Web UI -> API Client -> Fastify API -> Drizzle/Postgres
                           |-> Redis cache / BullMQ
                           |-> Meilisearch
                           |-> AIService
                                   |-> mocks when MOCK_SERVICES=true
                                   |-> OpenAI when MOCK_SERVICES=false
```

## Notes

- `MOCK_SERVICES=true` is the default and keeps development fully offline from third-party providers.
- Listing prices and off-market visibility intentionally change based on access tier.
- KYC submission, OTP, exchange rates, RERA validation, AI responses, and document analysis are all mock-backed by default.
