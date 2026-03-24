# System Design

## 1. Purpose
Describe the end-to-end design of the V1 platform from request flow to data persistence and service interactions.

## 2. Main Domains
- Identity & Access
- Learning Content
- Runtime Sessions & Sandboxes
- Query Execution & Evaluation
- Platform Operations

## 3. End-to-End Flows

### 3.1 Import Canonical Database
1. Admin calls the Admin API with schema definition and canonical row-count metadata.
2. API stores a new schema template version and classifies the source scale from total row count.
3. API creates the canonical dataset template plus all supported smaller dataset templates.
4. API records `system_jobs` entries for import and derived-template generation.
5. Dataset templates are published for learner sessions.

### 3.2 Start Learning Session
1. User opens a published lesson version or database page.
2. User selects an allowed dataset scale less than or equal to the source scale.
3. Web app calls `POST /v1/learning-sessions` or `POST /v1/databases/sessions`.
4. API validates user, lesson/database access, and requested scale.
5. API resolves the dataset template for the requested scale.
6. API creates `learning_sessions` record in status `provisioning`.
7. API enqueues sandbox creation job.
8. Worker creates sandbox instance from the selected schema + dataset template, using artifact restore when available or deterministic synthetic loading otherwise.
9. Worker marks sandbox ready and updates session.
10. UI polls session status until ready.

### 3.3 Run Query
1. User submits SQL from editor.
2. API fetches active learning session and assigned sandbox.
3. Query Execution module validates SQL category.
4. Query executes inside sandbox with timeout and preview limits.
5. Execution metadata is stored in `query_executions`.
6. Optional plan is stored in `query_execution_plans`.
7. Result preview and metrics are returned to UI.

### 3.4 Submit Challenge Attempt
1. User submits query as challenge attempt.
2. API links latest query execution or executes fresh query.
3. Evaluation engine compares output to expected validator config.
4. Score and feedback are stored in `challenge_evaluations`.
5. Attempt result is returned.

### 3.5 Reset Sandbox Or Change Scale
1. User clicks Reset.
2. User may optionally choose a different allowed scale.
3. API marks current sandbox reset requested and resolves the target dataset template.
4. Worker destroys current sandbox and re-provisions from the selected template, restoring from artifact when available or using deterministic synthetic loading otherwise.
5. Session references the new active sandbox or updated sandbox state.
6. History remains, but new executions use clean state.

### 3.6 Cleanup Expired Sandbox
1. Scheduler identifies idle sandboxes beyond TTL.
2. Worker marks sandbox `expiring`.
3. Sandbox is destroyed.
4. Session becomes `expired` or `ended`.
5. Lifecycle events are recorded.

## 4. Service Design

### 4.1 API Layer Architecture

The API service (`apps/api`) uses **Fastify v4** with a 4-layer architecture per feature module. Each module lives in `src/modules/<name>/` and contains:

| File | Role |
|------|------|
| `<name>.router.ts` | Fastify route registration, Swagger schema, auth hooks — no logic |
| `<name>.handler.ts` | Parse & validate input (Zod), call service, build response envelope |
| `<name>.service.ts` | Business logic and orchestration, throws typed `AppError` subclasses |
| `<name>.schema.ts` | Zod schemas and their inferred TypeScript types |
| `<name>.types.ts` | Module-local interfaces (e.g. joined/aggregated shapes) |

Data access is handled separately in `src/db/repositories/<name>.repository.ts` — Drizzle queries only, no business logic.

### 4.2 API Feature Modules

| Module path | Routes covered |
|-------------|---------------|
| `modules/auth` | `POST /v1/auth/*`, `GET /v1/auth/me` |
| `modules/users` | `GET /v1/users/me`, `PATCH /v1/users/me`, session/query history |
| `modules/tracks` | `GET /v1/tracks`, `GET /v1/tracks/:id` |
| `modules/lessons` | `GET /v1/lessons/:id`, `GET /v1/lesson-versions/:id` |
| `modules/challenges` | `POST /v1/challenge-attempts`, `GET /v1/challenge-attempts/:id` |
| `modules/sessions` | `POST /v1/learning-sessions`, `GET`, `POST .../end` |
| `modules/queries` | `POST /v1/query-executions`, `GET`, session query history |
| `modules/sandboxes` | `GET /v1/sandboxes/:id`, `POST .../reset` |
| `modules/admin` | Admin CRUD for tracks, lessons, challenges; user management; system health |

### 4.3 Worker Jobs

| Job file | Queue | Trigger |
|----------|-------|---------|
| `jobs/sandbox-provisioning.ts` | `sandbox-provisioning` | Session created |
| `jobs/sandbox-cleanup.ts` | `sandbox-cleanup` | Scheduled / session ended |
| `jobs/challenge-evaluation.ts` | `challenge-evaluation` | Challenge attempt submitted |
| `jobs/repair.ts` | `repair` | Scheduled — fixes stuck sandboxes |

## 5. Runtime State Model
### Learning Session States
- provisioning
- active
- paused
- ended
- expired
- failed

### Sandbox States
- requested
- provisioning
- ready
- busy
- resetting
- expiring
- destroyed
- failed

### Query Execution States
- accepted
- running
- succeeded
- failed
- timed_out
- blocked

## 6. Data Partitioning Strategy
- metadata stored centrally
- sandbox data stored per sandbox instance
- large plans optionally compressed or externalized if needed
- object storage used for generated template artifacts and imports

## 7. Failure Handling
### Sandbox creation failure
- session remains failed/provisioning_error
- UI shows retry option if allowed
- orphan resources are cleaned by repair worker

### Query timeout
- execution record marked `timed_out`
- clear feedback shown to user
- optional hint for optimization lessons

### Worker interruption
- jobs retried with idempotency key
- status transitions protected with optimistic checks

## 8. Design Trade-offs
### Container per session vs shared cluster with per-db isolation
V1 recommendation: containerized sandbox per active session where feasible for simplicity and isolation.
Trade-off:
- more resource cost
- simpler reasoning and safety

### Synchronous vs asynchronous provisioning
V1 uses asynchronous provisioning because large templates can be slow.

## 9. Sequence Diagram (Text)
```text
User -> Web App -> API -> Metadata DB (create session)
API -> Queue (create sandbox job)
Worker -> Sandbox Manager -> Docker/K8s -> Postgres Sandbox
Worker -> Metadata DB (mark ready)
Web App -> API (poll session)
User -> Web App -> API (run query)
API -> Query Executor -> Sandbox DB
Query Executor -> Metadata DB (save execution, plan)
API -> Web App (result + metrics)
```

## 10. Scaling Concerns
- sandbox density per node
- session TTL tuning
- queue backpressure during bursts
- heavy lesson templates needing prewarmed capacity
