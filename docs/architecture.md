# Architecture Overview

## 1. Architecture Goal
Provide a modular architecture that supports:
- content management
- sandbox provisioning
- safe query execution
- background operations
- future extension to additional engines and collaboration features

## 1.1 Canonical Product Language
- SQLCraft is a SQL platform, not a guided learning system.
- The only system roles are `user` and `admin`.
- Legacy entity names such as `tracks`, `lessons`, `challenges`, and `learning_sessions` may still exist in code and schema.

## 2. Architectural Style
The V1 platform uses a **modular service-oriented architecture**:
- monorepo for code organization
- multiple deployable services where needed
- stateless API services
- asynchronous workers for long-running operations
- isolated stateful databases for metadata and user sandboxes

## 2a. Tech Stack Decisions

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend | Next.js 16 (App Router) | SSR + RSC, strong typing, file-based routing |
| Backend API | **Fastify v4** + TypeScript | 3× throughput vs Express/NestJS, low memory, plugin-based, built-in Swagger |
| ORM | Drizzle ORM | Schema-as-code, types inferred from schema, lightweight migrations |
| Queue | BullMQ (Redis-backed) | Durable job queue with retry, backoff, and deduplication |
| Metadata DB | PostgreSQL 16 | Rich SQL, EXPLAIN support, production relevance |
| Sandbox DB | PostgreSQL 16 (separate instance) | Isolated from platform data |
| Cache / Lock | Redis 7 | Session state, distributed locks, queue backend |
| Object Storage | MinIO (S3-compatible) | Dataset artifacts, plan exports; swap to S3 in production |
| Monorepo tooling | pnpm workspaces + Turborepo | Dependency sharing, incremental builds |

> **Framework note:** Fastify was chosen over NestJS. NestJS appeared in early sketches but was not adopted. All code and documentation use Fastify conventions. See `docs/code-conventions.md § 1` for the full rationale.

## 3. High-Level Components
1. Web App
2. API Service
3. Query Execution Module
4. Sandbox Manager
5. Worker Service
6. Metadata Database
7. Redis / Queue
8. Sandbox PostgreSQL Instances
9. Object Storage for dataset artifacts and logs

## 4. Logical Architecture
```text
Browser
  |
  v
Web App (Next.js)
  |
  v
API Service
  |------------------------|
  |                        |
  v                        v
Metadata DB           Redis / Queue
  |                        |
  |                        v
  |                    Worker Service
  |                        |
  |                        v
  |                  Sandbox Manager
  |                        |
  |                        v
  |                PostgreSQL Sandboxes
  |
  v
Object Storage (artifacts / plans / datasets)
```

## 5. Component Responsibilities

### 5.1 Web App
- authentication UI
- track/lesson navigation
- editor and result table
- execution plan visualization
- query history
- challenge attempt submission

### 5.2 API Service
- auth and permission checks
- track/lesson/challenge retrieval
- session orchestration
- query submission
- challenge evaluation requests
- sandbox reset endpoints
- admin/content operations APIs

### 5.3 Query Execution Module
- SQL pre-validation
- execution against sandbox connection
- result shaping
- EXPLAIN / EXPLAIN ANALYZE retrieval
- persistence of execution and plan metadata

### 5.4 Sandbox Manager
- create sandbox from template
- reset sandbox
- mark sandbox ready/error/expired
- destroy sandbox
- emit lifecycle events

### 5.5 Worker Service
- async session bootstrap
- dataset generation jobs
- sandbox cleanup jobs
- repair/retry jobs
- metrics aggregation or housekeeping jobs

### 5.6 Metadata DB
- all platform metadata
- content versioning
- session metadata
- runtime audit trails
- query execution records

### 5.7 Redis / Queue
- short-lived state
- distributed locks where needed
- job queue for async workflows
- deduplication / retry metadata

## 6. Key Architectural Decisions
### AD-06 Fastify over NestJS/Express
Fastify was chosen as the API framework:
- ~3× higher throughput than Express in benchmarks
- Lower resident memory — important when co-located with sandbox containers
- TypeScript-first: full type inference via generics on `FastifyRequest<{Body, Params, Querystring}>`
- Plugin architecture is explicit and testable (no decorator magic)
- `@fastify/swagger` provides first-class OpenAPI 3.0 generation

NestJS was ruled out because its decorator-based DI and class metadata adds runtime overhead and complexity not needed for this use case.

### AD-01 PostgreSQL first
Chosen for:
- rich SQL support
- EXPLAIN / EXPLAIN ANALYZE
- realistic production relevance
- strong open-source ecosystem

### AD-02 Separate metadata DB from user sandbox DBs
This prevents:
- user actions affecting platform metadata
- operational and security coupling
- harder lifecycle cleanup

### AD-03 Version content and templates
Lessons/challenges/templates evolve frequently; versioning avoids breaking historical attempts and published tracks.

### AD-04 Session sandbox isolation
Each session maps to a dedicated sandbox instance or equivalent isolated environment.

### AD-05 Async provisioning
Sandbox creation can be slow relative to normal API calls, so jobs and status polling are first-class design concerns.

## 7. Deployment View
### Minimum hosted deployment
- 1 web app deployment
- 2+ API instances
- 1+ worker instances
- 1 metadata PostgreSQL instance
- 1 Redis instance
- Docker host or Kubernetes node pool for sandbox containers
- Object storage bucket

## 8. Future Architectural Extensions
- multiple DB engines
- collaborative sessions
- AI-assisted hint service
