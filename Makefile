.PHONY: dev build prod-setup prod prod-build prod-stop prod-logs prod-clean release-docker stop clean logs migrate seed test lint help

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

prod-setup: ## Generate .env.production with auto secrets + first admin (interactive)
	@set -e; \
	if [ ! -f .env.production ]; then \
		cp .env.production.example .env.production; \
		echo "Created .env.production from template."; \
	fi; \
	get_kv() { awk -F= -v k="$$1" '$$1==k {print $$2; exit}' "$$2"; }; \
	set_kv() { \
		key="$$1"; value="$$2"; file="$$3"; \
		awk -v k="$$key" -v v="$$value" 'BEGIN{done=0} $$0 ~ ("^"k"=") { print k"="v; done=1; next } { print } END { if (!done) print k"="v }' "$$file" > "$$file.tmp"; \
		mv "$$file.tmp" "$$file"; \
	}; \
	jwt_secret="$$(get_kv JWT_SECRET .env.production)"; \
	postgres_password="$$(get_kv POSTGRES_PASSWORD .env.production)"; \
	minio_password="$$(get_kv MINIO_ROOT_PASSWORD .env.production)"; \
	storage_secret="$$(get_kv STORAGE_SECRET_KEY .env.production)"; \
	sandbox_password="$$(get_kv SANDBOX_DB_PASSWORD .env.production)"; \
	admin_email="$$(get_kv FIRST_ADMIN_EMAIL .env.production)"; \
	admin_username="$$(get_kv FIRST_ADMIN_USERNAME .env.production)"; \
	admin_password="$$(get_kv FIRST_ADMIN_PASSWORD .env.production)"; \
	if [ -z "$$jwt_secret" ] || [ "$$jwt_secret" = "change-me" ]; then jwt_secret="$$(openssl rand -hex 32)"; fi; \
	if [ -z "$$postgres_password" ] || [ "$$postgres_password" = "change-me" ]; then postgres_password="$$(openssl rand -hex 16)"; fi; \
	if [ -z "$$minio_password" ] || [ "$$minio_password" = "change-me" ]; then minio_password="$$(openssl rand -hex 16)"; fi; \
	if [ -z "$$storage_secret" ] || [ "$$storage_secret" = "change-me" ]; then storage_secret="$$minio_password"; fi; \
	if [ -z "$$sandbox_password" ] || [ "$$sandbox_password" = "change-me" ]; then sandbox_password="$$(openssl rand -hex 16)"; fi; \
	if [ -z "$$admin_email" ] || [ "$$admin_email" = "admin@sqlcraft.local" ]; then \
		echo ""; \
		echo "Configure first admin (press Enter for defaults):"; \
		default_email="admin@sqlcraft.local"; \
		default_username="admin"; \
		default_password="$$(openssl rand -hex 12)"; \
		printf "  FIRST_ADMIN_EMAIL [$${default_email}]: "; \
		read input_admin_email; \
		admin_email="$${input_admin_email:-$${default_email}}"; \
		printf "  FIRST_ADMIN_USERNAME [$${default_username}]: "; \
		read input_admin_username; \
		admin_username="$${input_admin_username:-$${default_username}}"; \
		printf "  FIRST_ADMIN_PASSWORD [auto-generated]: "; \
		read input_admin_password; \
		admin_password="$${input_admin_password:-$${default_password}}"; \
	elif [ -z "$$admin_password" ] || [ "$$admin_password" = "change-me" ]; then \
		admin_password="$$(openssl rand -hex 12)"; \
	fi; \
	set_kv "JWT_SECRET" "$$jwt_secret" ".env.production"; \
	set_kv "POSTGRES_PASSWORD" "$$postgres_password" ".env.production"; \
	set_kv "DATABASE_URL" "postgresql://sqlcraft:$$postgres_password@postgres:5432/sqlcraft" ".env.production"; \
	set_kv "MINIO_ROOT_PASSWORD" "$$minio_password" ".env.production"; \
	set_kv "STORAGE_SECRET_KEY" "$$storage_secret" ".env.production"; \
	set_kv "SANDBOX_DB_PASSWORD" "$$sandbox_password" ".env.production"; \
	set_kv "FIRST_ADMIN_EMAIL" "$$admin_email" ".env.production"; \
	set_kv "FIRST_ADMIN_USERNAME" "$$admin_username" ".env.production"; \
	set_kv "FIRST_ADMIN_PASSWORD" "$$admin_password" ".env.production"; \
	set_kv "NEXT_PUBLIC_APP_URL" "http://localhost:13029" ".env.production"; \
	set_kv "ALLOWED_ORIGINS" "http://localhost:13029" ".env.production"; \
	set_kv "NEXT_PUBLIC_API_URL" "http://localhost:4000/v1" ".env.production"; \
	echo ""; \
	echo "Saved .env.production (secrets ensured)."; \
	echo "First admin:"; \
	echo "  email: $$admin_email"; \
	echo "  username: $$admin_username"; \
	echo "  password: $$admin_password"; \
	echo ""

prod-build: prod-setup ## Build images, bootstrap DB/admin, and start production stack
	@set -e; \
	docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build postgres redis minio; \
	docker compose --env-file .env.production -f docker-compose.prod.yml run --rm --entrypoint sh api -lc "pnpm --filter @sqlcraft/api exec drizzle-kit migrate && pnpm --filter @sqlcraft/api db:seed"; \
	docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build api web worker; \
	first_admin_email="$$(awk -F= '/^FIRST_ADMIN_EMAIL=/{print $$2}' .env.production)"; \
	first_admin_username="$$(awk -F= '/^FIRST_ADMIN_USERNAME=/{print $$2}' .env.production)"; \
	first_admin_password="$$(awk -F= '/^FIRST_ADMIN_PASSWORD=/{print $$2}' .env.production)"; \
	echo ""; \
	echo "Production stack is running."; \
	echo "Web: http://localhost:13029"; \
	echo "API: http://localhost:4000"; \
	echo "First admin login:"; \
	echo "  email: $$first_admin_email"; \
	echo "  username: $$first_admin_username"; \
	echo "  password: $$first_admin_password"; \
	echo "Use: make prod-logs"

prod: ## Start production stack without rebuilding images
	@test -f .env.production || (echo "Missing .env.production — copy from .env.production.example and edit." && exit 1)
	docker compose --env-file .env.production -f docker-compose.prod.yml up -d

prod-stop: ## Stop production stack
	@docker compose --env-file .env.production -f docker-compose.prod.yml down 2>/dev/null || docker compose -f docker-compose.prod.yml down

prod-logs: ## Tail production stack logs
	@docker compose --env-file .env.production -f docker-compose.prod.yml logs -f 2>/dev/null || docker compose -f docker-compose.prod.yml logs -f

prod-clean: ## Stop production stack and remove volumes
	docker compose -f docker-compose.prod.yml down -v

release-docker: ## Build production Docker images only (no compose up; optional: NEXT_PUBLIC_API_URL=... for web)
	docker compose -f docker-compose.prod.yml build

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
