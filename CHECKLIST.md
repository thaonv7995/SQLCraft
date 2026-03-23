# SQLCraft — Project Overview Checklist

> Last updated: 2026-03-23
> Status legend: ✅ Done | 🚧 In Progress | ⬜ Pending | ❌ Blocked

---

## 0. Foundation

| # | Task | Status | Notes |
|---|------|--------|-------|
| 0.1 | Monorepo setup (pnpm workspaces + Turborepo) | ✅ | `package.json`, `pnpm-workspace.yaml`, `turbo.json` |
| 0.2 | Shared types package (`@sqlcraft/types`) | ✅ | All domain types + `ApiCode` enum |
| 0.3 | Shared config package (`@sqlcraft/config`) | ✅ | tsconfig.base, eslint-base |
| 0.4 | `.env.example` with all variables documented | ✅ | |
| 0.5 | `.gitignore` | ✅ | |
| 0.6 | `LICENSE` (MIT) | ✅ | |
| 0.7 | `README.md` | ✅ | |
| 0.8 | `CONTRIBUTING.md` | ✅ | |
| 0.9 | `Makefile` (single-command operations) | ✅ | `make dev`, `make prod`, `make migrate`, etc. |
| 0.10 | GitHub Actions CI | ✅ | lint/typecheck + test jobs |
| 0.11 | PR template | ✅ | |

---

## 1. Infrastructure & Docker

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1.1 | `docker-compose.dev.yml` | ✅ | postgres, sandbox-postgres, redis, minio, api, web, worker |
| 1.2 | `docker-compose.prod.yml` | ⬜ | Production compose with proper resource limits |
| 1.3 | `apps/api/Dockerfile.dev` | ✅ | Hot reload with tsx |
| 1.4 | `apps/api/Dockerfile` (prod) | ⬜ | Multi-stage build |
| 1.5 | `apps/web/Dockerfile.dev` | ✅ | Next.js dev |
| 1.6 | `apps/web/Dockerfile` (prod) | ⬜ | Standalone Next.js build |
| 1.7 | `services/worker/Dockerfile.dev` | ✅ | |
| 1.8 | `services/worker/Dockerfile` (prod) | ⬜ | |
| 1.9 | MinIO bucket init script | ⬜ | Auto-create `sqlcraft` bucket on startup |
| 1.10 | Sandbox postgres initialization SQL | ⬜ | Template DB for learner sandboxes |
| 1.11 | Nginx config (optional, reverse proxy) | ⬜ | |

---

## 2. Backend API (`apps/api`)

### 2.1 Core Setup
| # | Task | Status | Notes |
|---|------|--------|-------|
| 2.1.1 | Fastify app entry point | ✅ | CORS, Helmet, rate-limit, JWT |
| 2.1.2 | Swagger / OpenAPI 3.0 at `/docs` | ✅ | |
| 2.1.3 | Standardized response format `{ success, code, message, data }` | ✅ | All routes compliant |
| 2.1.4 | Global error handler | ✅ | AppError, ZodError, JWT errors, 9001 fallback |
| 2.1.5 | Auth plugin (authenticate / authorize) | ✅ | |
| 2.1.6 | Request logging with pino | ✅ | |

### 2.2 Database
| # | Task | Status | Notes |
|---|------|--------|-------|
| 2.2.1 | Drizzle ORM schema (all 18 tables) | ✅ | |
| 2.2.2 | Initial migration | ⬜ | Run `make migrate` after `pnpm install` |
| 2.2.3 | Seed data | ✅ | Admin user, sample tracks, ecommerce schema |
| 2.2.4 | Index optimizations | ✅ | Defined in schema |
| 2.2.5 | Connection pooling | ✅ | pg Pool, configurable max |

### 2.3 API Routes
| # | Task | Status | Notes |
|---|------|--------|-------|
| 2.3.1 | `POST /v1/auth/register` | ✅ | |
| 2.3.2 | `POST /v1/auth/login` | ✅ | |
| 2.3.3 | `POST /v1/auth/logout` | ✅ | |
| 2.3.4 | `POST /v1/auth/refresh` | ✅ | |
| 2.3.5 | `GET /v1/auth/me` | ✅ | |
| 2.3.6 | `GET /v1/tracks` (paginated) | ✅ | |
| 2.3.7 | `GET /v1/tracks/:id` | ✅ | |
| 2.3.8 | `GET /v1/lessons/:id` | ✅ | |
| 2.3.9 | `GET /v1/lesson-versions/:id` | ✅ | |
| 2.3.10 | `POST /v1/learning-sessions` | ✅ | Enqueues sandbox provisioning |
| 2.3.11 | `GET /v1/learning-sessions/:id` | ✅ | |
| 2.3.12 | `POST /v1/learning-sessions/:id/end` | ✅ | |
| 2.3.13 | `POST /v1/query-executions` | ✅ | SQL validation + execution |
| 2.3.14 | `GET /v1/query-executions/:id` | ✅ | |
| 2.3.15 | `GET /v1/learning-sessions/:id/query-executions` | ✅ | |
| 2.3.16 | `POST /v1/challenge-attempts` | ✅ | |
| 2.3.17 | `GET /v1/challenge-attempts/:id` | ✅ | |
| 2.3.18 | `GET /v1/sandboxes/:id` | ✅ | |
| 2.3.19 | `POST /v1/sandboxes/:sessionId/reset` | ✅ | |
| 2.3.20 | Admin CRUD: tracks, lessons, versions | ✅ | |
| 2.3.21 | Admin: user management | ✅ | |
| 2.3.22 | Admin: system health endpoint | ✅ | |
| 2.3.23 | `GET /v1/users/me` + `PATCH` | ✅ | |
| 2.3.24 | `GET /v1/users/me/sessions` | ✅ | |
| 2.3.25 | `GET /v1/users/me/query-history` | ✅ | |
| 2.3.26 | Leaderboard endpoints | ⬜ | `/v1/leaderboard` |
| 2.3.27 | Schema templates CRUD | ⬜ | Admin only |
| 2.3.28 | Dataset templates CRUD | ⬜ | Admin only |

### 2.4 Business Logic
| # | Task | Status | Notes |
|---|------|--------|-------|
| 2.4.1 | SQL validator (blocklist) | ✅ | DROP, TRUNCATE, DDL blocking |
| 2.4.2 | Query executor (sandbox connection) | ✅ | Statement timeout |
| 2.4.3 | EXPLAIN / EXPLAIN ANALYZE | ✅ | |
| 2.4.4 | Result shaping (max 500 rows) | ✅ | |
| 2.4.5 | Challenge evaluation engine | 🚧 | Basic result-set check; needs refinement |
| 2.4.6 | Sandbox provisioning (real Docker) | ⬜ | Currently stub; needs dockerode integration |
| 2.4.7 | Sandbox cleanup / expiry logic | ⬜ | Worker job |
| 2.4.8 | Dataset generation from templates | ⬜ | Worker job |
| 2.4.9 | Idempotency keys for session creation | ⬜ | |
| 2.4.10 | Rate limiting per user | ⬜ | Currently global only |

---

## 3. Worker Service (`services/worker`)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 3.1 | BullMQ worker setup | ✅ | 4 queues: sandbox-provisioning, sandbox-cleanup, dataset-generation, challenge-evaluation |
| 3.2 | Sandbox provisioning job handler | 🚧 | Stub — needs dockerode/real implementation |
| 3.3 | Sandbox cleanup job handler | 🚧 | Stub |
| 3.4 | Dataset generation job handler | 🚧 | Stub |
| 3.5 | Challenge evaluation job handler | 🚧 | Stub |
| 3.6 | Graceful shutdown | ✅ | SIGTERM/SIGINT handlers |
| 3.7 | Job retry with exponential backoff | ⬜ | |
| 3.8 | Job metrics / monitoring | ⬜ | |

---

## 4. Frontend (`apps/web`)

### 4.1 Core
| # | Task | Status | Notes |
|---|------|--------|-------|
| 4.1.1 | Next.js 14 App Router setup | ✅ | |
| 4.1.2 | Tailwind with full design system colors | ✅ | All Stitch colors configured |
| 4.1.3 | Space Grotesk + Inter + JetBrains Mono fonts | ✅ | |
| 4.1.4 | Global CSS + scrollbar styles | ✅ | |
| 4.1.5 | TanStack Query provider | ✅ | |
| 4.1.6 | Zustand auth store | ✅ | Persisted to localStorage |
| 4.1.7 | Zustand lab store | ✅ | Query workspace state |
| 4.1.8 | Typed API client (axios) | ✅ | Auto-unwraps response envelope |

### 4.2 UI Components
| # | Task | Status | Notes |
|---|------|--------|-------|
| 4.2.1 | Button (primary/secondary/ghost/destructive) | ✅ | |
| 4.2.2 | Badge / StatusBadge | ✅ | All status variants |
| 4.2.3 | Card / StatCard | ✅ | |
| 4.2.4 | Input / Textarea / Select | ✅ | |
| 4.2.5 | Table (alternating rows, no borders) | ✅ | |
| 4.2.6 | Navbar | ✅ | Brand, nav, user menu |
| 4.2.7 | Sidebar | ✅ | Material Symbols icons |
| 4.2.8 | Modal / Dialog | ⬜ | |
| 4.2.9 | Toast notifications | ✅ | react-hot-toast |
| 4.2.10 | Skeleton loaders | ✅ | TableSkeleton |
| 4.2.11 | Pagination component | ⬜ | |
| 4.2.12 | CodeMirror SQL editor | 🚧 | Using textarea fallback; needs @uiw/react-codemirror |
| 4.2.13 | Execution plan tree visualizer | ⬜ | D3 or custom recursive component |
| 4.2.14 | Schema explorer tree | ⬜ | Expandable table/column tree |
| 4.2.15 | Split pane (resizable) | ⬜ | Needs react-resizable-panels |
| 4.2.16 | Dropdown / Popover | ⬜ | |

### 4.3 Pages
| # | Page | Design Source | Status | Notes |
|---|------|--------------|--------|-------|
| 4.3.1 | Login | Custom | ✅ | |
| 4.3.2 | Register | Custom | ✅ | |
| 4.3.3 | Dashboard | Custom | ✅ | Stats, recent sessions, tracks |
| 4.3.4 | Tracks List | Custom | ✅ | Filter by difficulty |
| 4.3.5 | Track Detail | Custom | ✅ | Lesson list with lock states |
| 4.3.6 | SQL Lab (main workbench) | `final_query_workbench` | 🚧 | Split pane, tabs, status bar |
| 4.3.7 | Lab Session Init | Custom | ✅ | Dataset size selector |
| 4.3.8 | Query History | `final_query_history_1/2` | ✅ | Expandable rows, search, filter |
| 4.3.9 | Database Explorer | `final_database_explorer_1/2` | ⬜ | Separate page for DB schema browsing |
| 4.3.10 | Schema Explorer | `final_schema_explorer_1/2` | ⬜ | Table columns, types, indexes |
| 4.3.11 | Execution Plan Viewer | `final_execution_plan_deep_dive_1/2` | ⬜ | Full plan tree, node details |
| 4.3.12 | Sandbox Provisioning Status | `final_sandbox_provisioning_1/2` | ⬜ | Loading/status page |
| 4.3.13 | Code Snippets / Cheatsheet | `final_code_snippets_1/2` | ⬜ | SQL reference snippets |
| 4.3.14 | Lesson Page | Custom | ⬜ | MDX-rendered lesson content |
| 4.3.15 | Challenge Page | Custom | ⬜ | Problem statement + editor |
| 4.3.16 | Admin: Dashboard/Health | `super_admin_system_health` | ✅ | |
| 4.3.17 | Admin: User Management | `super_admin_user_management` | ✅ | |
| 4.3.18 | Admin: System Logs | `super_admin_system_logs` | ⬜ | |
| 4.3.19 | Admin: Content Management | Custom | ✅ | |
| 4.3.20 | Admin: Lesson/Challenge Editor | `lesson_challenge_editor` | ⬜ | Rich text + SQL editor |
| 4.3.21 | Admin: Database Overview | `final_database_overview_1/2` | ⬜ | ER diagram view |
| 4.3.22 | Contributor Dashboard | `contributor_dashboard` | ✅ | |
| 4.3.23 | Leaderboard | `competitive_tracks_leaderboards` | ✅ | |
| 4.3.24 | User Profile / Settings | Custom | ⬜ | |
| 4.3.25 | Not Found (404) | Custom | ⬜ | |
| 4.3.26 | Landing / Marketing page | Custom | ⬜ | Public-facing intro |

---

## 5. Testing

| # | Task | Status | Notes |
|---|------|--------|-------|
| 5.1 | API unit tests (Vitest) | ⬜ | Especially query-executor, auth service |
| 5.2 | API integration tests | ⬜ | Against real test DB |
| 5.3 | Frontend component tests | ⬜ | Vitest + Testing Library |
| 5.4 | E2E tests (Playwright) | ⬜ | Core flows: register → start session → run query |
| 5.5 | API contract tests | ⬜ | Ensure routes match OpenAPI spec |

---

## 6. Observability

| # | Task | Status | Notes |
|---|------|--------|-------|
| 6.1 | Structured JSON logging (pino) | ✅ | API + Worker |
| 6.2 | Request tracing / correlation IDs | ⬜ | |
| 6.3 | Health check endpoint `GET /health` | ⬜ | DB + Redis connectivity check |
| 6.4 | Prometheus metrics endpoint | ⬜ | |
| 6.5 | Dashboard for metrics (Grafana in docker-compose) | ⬜ | |
| 6.6 | Error alerting | ⬜ | |
| 6.7 | Audit log viewer in Admin UI | ⬜ | |

---

## 7. Security

| # | Task | Status | Notes |
|---|------|--------|-------|
| 7.1 | Password hashing (bcryptjs) | ✅ | |
| 7.2 | JWT with short expiry + refresh tokens | ✅ | |
| 7.3 | SQL blocklist (DDL, dangerous DML) | ✅ | |
| 7.4 | Rate limiting (global) | ✅ | |
| 7.5 | Per-user rate limiting | ⬜ | |
| 7.6 | Sandbox network isolation | ⬜ | No internet access from sandbox |
| 7.7 | Query timeout enforcement | ✅ | statement_timeout in pg |
| 7.8 | Role-based access control | 🚧 | Roles seeded; enforce on all admin routes |
| 7.9 | HTTPS enforcement | ⬜ | Production only |
| 7.10 | Secrets rotation docs | ⬜ | |

---

## 8. Documentation

| # | Task | Status | Notes |
|---|------|--------|-------|
| 8.1 | PRD | ✅ | `docs/PRD.md` |
| 8.2 | Architecture doc | ✅ | `docs/architecture.md` |
| 8.3 | API spec | ✅ | `docs/api-spec.md` + Swagger at `/docs` |
| 8.4 | Database design | ✅ | `docs/database-design.md` |
| 8.5 | Development plan | ✅ | `docs/development-plan.md` |
| 8.6 | Dev environment setup | ✅ | `docs/dev-environment.md` |
| 8.7 | Deployment guide | ✅ | `docs/deployment-guide.md` |
| 8.8 | Contributing guide | ✅ | `CONTRIBUTING.md` |
| 8.9 | Seed lesson content (real SQL lessons) | ⬜ | |
| 8.10 | Storybook for UI components | ⬜ | |

---

## 9. Content (Seed Data)

| # | Task | Status | Notes |
|---|------|--------|-------|
| 9.1 | Ecommerce schema template | ✅ | users, orders, products, categories, order_items |
| 9.2 | SQL Fundamentals track (4 lessons) | ✅ | |
| 9.3 | Query Optimization track (stub) | ✅ | |
| 9.4 | Real lesson content (markdown) | ⬜ | SELECT basics, JOINs, aggregations, indexes |
| 9.5 | Challenge validators for each lesson | ⬜ | |
| 9.6 | Dataset generation scripts | ⬜ | Faker.js-based scripts for each size tier |

---

## 10. Release Readiness

| # | Task | Status | Notes |
|---|------|--------|-------|
| 10.1 | `make dev` boots full system | 🚧 | Needs `pnpm install` first |
| 10.2 | `make prod` production deploy | ⬜ | Needs prod Dockerfiles |
| 10.3 | End-to-end happy path working | ⬜ | register → session → query → challenge |
| 10.4 | Performance baseline documented | ⬜ | |
| 10.5 | Security review | ⬜ | |
| 10.6 | Contributor onboarding tested | ⬜ | Fresh clone → working in < 10 min |
| 10.7 | v0.1.0 release tag | ⬜ | |

---

## Sub-Agent Task Breakdown

> The following tasks are well-scoped for independent sub-agent work:

### Agent: `sandbox-impl`
Build real sandbox provisioning using `dockerode` or `pg` template database cloning:
- `services/worker/src/jobs/sandbox-provisioning.ts` — real implementation
- `apps/api/src/services/sandbox-manager.ts` — create/reset/destroy sandboxes
- Integration with `sandbox-postgres` container

### Agent: `codemirror-editor`
Build the production SQL editor component:
- `apps/web/src/components/editor/sql-editor.tsx` — CodeMirror 6 with SQL language
- Custom dark theme matching design system colors
- Syntax highlighting, autocompletion, keyboard shortcuts

### Agent: `execution-plan-viewer`
Build the execution plan visualization:
- `apps/web/src/components/lab/execution-plan.tsx` — recursive node tree
- Node detail panel with cost, rows, type
- EXPLAIN vs EXPLAIN ANALYZE toggle

### Agent: `lesson-engine`
Build the lesson rendering system:
- `apps/web/src/components/lesson/lesson-renderer.tsx` — MDX content with embedded challenges
- Challenge attempt form with validation
- Progress tracking

### Agent: `dataset-generator`
Build dataset generation scripts:
- `scripts/generate-dataset.ts` — Faker.js-based data generator for ecommerce schema
- Support for tiny/small/medium/large size tiers
- Export to SQL dump format

### Agent: `prod-deploy`
Production Dockerfiles and compose:
- Multi-stage Dockerfiles for api/web/worker
- `docker-compose.prod.yml` with proper limits
- Environment configuration for production

### Agent: `testing`
Build test suite:
- API integration tests (Vitest + supertest)
- Frontend component tests (Vitest + @testing-library/react)
- E2E tests with Playwright

### Agent: `admin-lesson-editor`
Build the admin lesson/challenge editor:
- Rich markdown editor with preview
- SQL challenge editor with test runner
- Version management UI
- Publish workflow

---

## Getting Started (Developer)

```bash
# 1. Clone the repo
git clone https://github.com/your-org/sqlcraft.git
cd sqlcraft

# 2. Install dependencies
make setup

# 3. Start the full dev environment (single command!)
make dev

# 4. Open in browser
# Web:    http://localhost:3000
# API:    http://localhost:4000
# Docs:   http://localhost:4000/docs
# MinIO:  http://localhost:9001  (admin/minioadmin)
```
