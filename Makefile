# ─── EstateVault – root Makefile ──────────────────────────────────────────────
# Usage: make <target>
# Run `make` or `make help` to list available targets.
#
# Prerequisites:
#   pnpm   – https://pnpm.io
#   turbo  – installed via pnpm (pnpm add -g turbo)
#   docker – https://docs.docker.com/get-docker/
#   kubectl – https://kubernetes.io/docs/tasks/tools/ (for k8s targets)
# ─────────────────────────────────────────────────────────────────────────────

# Default goal – show help.
.DEFAULT_GOAL := help

# Allow callers to pass REGISTRY=registry.example.com/vault for docker-push.
REGISTRY ?= ghcr.io/vault

# The service to tail logs for (override with: make logs service=listing-service).
service ?= api-gateway

# Colours for help output.
BOLD  := \033[1m
RESET := \033[0m
CYAN  := \033[36m

# ─── Help ─────────────────────────────────────────────────────────────────────

.PHONY: help
help: ## Print available targets (default)
	@printf '\n$(BOLD)EstateVault – available make targets$(RESET)\n\n'
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  $(CYAN)%-22s$(RESET) %s\n", $$1, $$2}'
	@printf '\n'

# ─── Local development ────────────────────────────────────────────────────────

.PHONY: dev
dev: ## Start all apps/services in watch mode via Turborepo
	pnpm turbo dev

.PHONY: dev-infra
dev-infra: ## Start only infrastructure containers (postgres, redis, meilisearch)
	docker compose up -d postgres redis meilisearch

.PHONY: dev-services
dev-services: ## Start all 9 microservice containers (detached)
	docker compose up -d \
		api-gateway \
		identity-service \
		listing-service \
		messaging-service \
		media-service \
		call-service \
		ai-service \
		notification-service \
		analytics-service \
		web

# ─── Build & quality ──────────────────────────────────────────────────────────

.PHONY: build
build: ## Build all packages and services via Turborepo
	pnpm turbo build

.PHONY: type-check
type-check: ## Run TypeScript type checking across the monorepo
	pnpm turbo type-check

.PHONY: lint
lint: ## Run ESLint across the monorepo
	pnpm turbo lint

.PHONY: test
test: ## Run all test suites via Turborepo
	pnpm turbo test

.PHONY: clean
clean: ## Remove all build artefacts (dist/, .next/, etc.)
	pnpm turbo clean

# ─── Database ─────────────────────────────────────────────────────────────────

.PHONY: db-generate
db-generate: ## Generate Prisma client(s) from schema(s)
	pnpm turbo db:generate

.PHONY: db-migrate
db-migrate: ## Run pending Prisma migrations
	pnpm turbo db:migrate

.PHONY: db-seed
db-seed: ## Seed database(s) with development fixtures
	pnpm turbo db:seed

# ─── Docker ───────────────────────────────────────────────────────────────────

.PHONY: docker-build
docker-build: ## Build all Docker images defined in docker-compose.yml
	docker compose build

.PHONY: docker-push
docker-push: ## Push all images to $(REGISTRY) (set REGISTRY=... to override)
	@if [ -z "$(REGISTRY)" ]; then \
		echo "ERROR: REGISTRY is not set. Run: make docker-push REGISTRY=registry.example.com/vault"; \
		exit 1; \
	fi
	docker compose build
	docker compose push

# ─── Kubernetes ───────────────────────────────────────────────────────────────

.PHONY: k8s-apply-staging
k8s-apply-staging: ## Apply Kustomize overlay to the staging cluster
	kubectl apply -k k8s/overlays/staging

.PHONY: k8s-apply-prod
k8s-apply-prod: ## Apply Kustomize overlay to the production cluster
	@printf '$(BOLD)Applying to PRODUCTION – press Ctrl-C within 5 s to abort...$(RESET)\n'
	@sleep 5
	kubectl apply -k k8s/overlays/production

# ─── Observability ────────────────────────────────────────────────────────────

.PHONY: logs
logs: ## Tail logs for a specific service (default: api-gateway). Usage: make logs service=listing-service
	docker compose logs -f --tail=100 $(service)

.PHONY: ps
ps: ## Show status of all running Docker Compose containers
	docker compose ps
