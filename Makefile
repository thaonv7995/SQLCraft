.PHONY: dev build prod stop clean logs migrate seed test lint help

# Default target
.DEFAULT_GOAL := help

# Colors
CYAN := \033[36m
RESET := \033[0m
BOLD := \033[1m

help: ## Show this help message
	@echo "$(BOLD)SQLCraft - Development Commands$(RESET)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  $(CYAN)%-20s$(RESET) %s\n", $$1, $$2}'

# ---- Environment ----
setup: ## Initial project setup (install deps, copy env)
	@echo "Setting up SQLCraft..."
	@cp -n .env.example .env || true
	@pnpm install
	@echo "Setup complete. Run 'make dev' to start."

# ---- Development ----
dev: ## Start full dev environment (Docker + services)
	@echo "Starting SQLCraft dev environment..."
	@docker compose -f docker-compose.dev.yml up -d postgres redis minio
	@echo "Waiting for databases..."
	@sleep 3
	@pnpm run db:migrate
	@pnpm run db:seed
	@docker compose -f docker-compose.dev.yml up --build api web worker

dev-infra: ## Start only infrastructure (Postgres, Redis, MinIO)
	docker compose -f docker-compose.dev.yml up -d postgres redis minio

dev-services: ## Start app services without rebuilding infra
	docker compose -f docker-compose.dev.yml up --build api web worker

dev-logs: ## Tail logs from all services
	docker compose -f docker-compose.dev.yml logs -f

# ---- Database ----
migrate: ## Run database migrations
	pnpm --filter @sqlcraft/api db:migrate

migrate-down: ## Rollback last migration
	pnpm --filter @sqlcraft/api db:migrate:down

seed: ## Seed database with sample data
	pnpm --filter @sqlcraft/api db:seed

db-reset: ## Drop and recreate database
	docker compose -f docker-compose.dev.yml exec postgres psql -U sqlcraft -c "DROP DATABASE IF EXISTS sqlcraft;" || true
	docker compose -f docker-compose.dev.yml exec postgres psql -U sqlcraft -c "CREATE DATABASE sqlcraft;" || true
	$(MAKE) migrate
	$(MAKE) seed

db-studio: ## Open Drizzle Studio
	pnpm --filter @sqlcraft/api db:studio

# ---- Build & Deploy ----
build: ## Build all packages for production
	pnpm run build

prod: ## Start production environment
	docker compose -f docker-compose.prod.yml up -d

prod-build: ## Build and start production environment
	docker compose -f docker-compose.prod.yml up -d --build

# ---- Testing ----
test: ## Run all tests
	pnpm run test

test-api: ## Run API tests
	pnpm --filter @sqlcraft/api test

test-web: ## Run frontend tests
	pnpm --filter @sqlcraft/web test

# ---- Code Quality ----
lint: ## Run linter
	pnpm run lint

typecheck: ## Run TypeScript type checking
	pnpm run typecheck

format: ## Format code with Prettier
	pnpm exec prettier --write .

# ---- Cleanup ----
stop: ## Stop all Docker services
	docker compose -f docker-compose.dev.yml down

clean: ## Stop services and remove volumes
	docker compose -f docker-compose.dev.yml down -v
	rm -rf apps/*/node_modules packages/*/node_modules services/*/node_modules
	rm -rf apps/*/.next apps/*/dist services/*/dist packages/*/dist

# ---- Utilities ----
logs: ## Show logs for a specific service (usage: make logs SERVICE=api)
	docker compose -f docker-compose.dev.yml logs -f $(SERVICE)

shell-api: ## Open shell in API container
	docker compose -f docker-compose.dev.yml exec api sh

shell-db: ## Open psql in Postgres container
	docker compose -f docker-compose.dev.yml exec postgres psql -U sqlcraft -d sqlcraft
