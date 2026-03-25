# System Audit And API Report

Date: 2026-03-25

## Executive Summary

- Frontend feature surface discovered: 32 page routes in `apps/web/src/app`.
- API surface discovered: 66 route definitions across 10 router modules.
- No runtime mock API implementation was found in the backend.
- Runtime mock data and fallback catalog behavior were found in the frontend and removed in this audit slice.
- API implementation exists across all registered router modules, but the system is not yet at a level where every API can be called “fully complete”.
- Main reason: the backend currently proves business logic mostly through service tests, not HTTP contract/integration tests.
- Manual HTTP verification initially exposed several runtime blockers, and the follow-up fixes in this audit slice now verify cleanly in the current Docker dev stack:
- sandbox provisioning and live query execution succeed end-to-end
- `/v1/leaderboard` now exists for the rankings screens
- `/v1/admin/config` works after restoring the migration path on API startup
- `POST /v1/admin/users` with `role: "user"` now creates a non-admin account with stored role `learner`
- `POST /v1/users/me/avatar` now succeeds with a valid MinIO presigned URL
- Docker dev now sets a dedicated BullMQ `QUEUE_PREFIX`, which prevents stray host-side workers from consuming the same Redis jobs as the compose stack

## Runtime Hardcode / Mock Audit

### Findings

1. `apps/web/src/app/(app)/explore/page.tsx`
   - used `PLACEHOLDER_DATABASES` when `GET /v1/databases` did not return data
2. `apps/web/src/app/(app)/dashboard/page.tsx`
   - used `PLACEHOLDER_DATABASES` for featured database cards
3. `apps/web/src/app/(app)/explore/[dbId]/page.tsx`
   - used `getFallbackDatabase` when `GET /v1/databases/:databaseId` failed
4. `apps/web/src/app/(app)/tracks/page.tsx`
   - used `PLACEHOLDER_TRACKS` when `GET /v1/tracks` returned empty or failed
5. `apps/web/src/lib/database-catalog.ts`
   - contained a large hardcoded catalog used as runtime fallback data
6. `apps/web/src/app/(app)/tracks/[trackId]/lessons/[lessonId]/page.tsx`
   - still showed stale placeholder copy for challenge entry CTA

### Fixes Applied

- Replaced placeholder data branches with honest empty/error states.
- Added retry affordances instead of synthetic catalog content.
- Deleted the hardcoded database catalog from the shared frontend utility.
- Updated the stale placeholder CTA copy in the lesson page.

### Remaining Mock Usage

- Test-only mocks remain in `.test.ts` and `.test.tsx` files.
- Those are acceptable and were not removed.

## Feature Inventory

### User-facing areas

- Auth: login, register
- Dashboard
- Database explorer and database detail
- Practice collections, practice set, challenge detail
- Lab
- Query history
- Leaderboard
- Profile
- Settings
- Docs
- Submissions / contributor flow

### Admin areas

- Admin home
- Content management
- Database management and import
- User management
- System health and jobs
- Settings / support redirects

## API Inventory

### Auth

- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/logout`
- `POST /v1/auth/refresh`
- `GET /v1/auth/me`

### Databases

- `GET /v1/databases`
- `GET /v1/databases/:databaseId`
- `POST /v1/databases/sessions`

### Tracks

- `GET /v1/tracks`
- `GET /v1/tracks/:trackId`

### Lessons

- `GET /v1/lessons/:lessonId`
- `GET /v1/lesson-versions/:versionId`

### Sessions

- `GET /v1/learning-sessions`
- `POST /v1/learning-sessions`
- `GET /v1/learning-sessions/:sessionId`
- `GET /v1/learning-sessions/:sessionId/schema`
- `GET /v1/learning-sessions/:sessionId/schema-diff`
- `POST /v1/learning-sessions/:sessionId/end`

### Queries

- `GET /v1/query-executions`
- `POST /v1/query-executions`
- `GET /v1/query-executions/:id`
- `GET /v1/learning-sessions/:sessionId/query-executions`

### Challenges

- `GET /v1/leaderboard`
- `GET /v1/challenges`
- `GET /v1/challenges/mine`
- `POST /v1/challenges`
- `POST /v1/challenges/validate`
- `GET /v1/challenges/:id/draft`
- `POST /v1/challenges/:id/versions`
- `GET /v1/challenge-versions/:id`
- `POST /v1/challenge-attempts`
- `GET /v1/challenge-attempts`
- `GET /v1/challenge-attempts/:id`
- `GET /v1/challenge-versions/:id/leaderboard`
- `GET /v1/admin/challenges`
- `POST /v1/admin/challenge-versions/:id/review`

### Sandboxes

- `GET /v1/sandboxes/:sandboxId`
- `POST /v1/sandboxes/:sessionId/reset`

### Users

- `GET /v1/users/me`
- `PATCH /v1/users/me`
- `POST /v1/users/me/avatar`
- `POST /v1/users/me/change-password`
- `GET /v1/users/me/sessions`
- `GET /v1/users/me/query-history`

### Admin

- `POST /v1/admin/tracks`
- `PATCH /v1/admin/tracks/:id`
- `POST /v1/admin/lessons`
- `POST /v1/admin/lesson-versions`
- `GET /v1/admin/lessons/:id/versions`
- `GET /v1/admin/lesson-versions/:id`
- `POST /v1/admin/lesson-versions/:id/publish`
- `POST /v1/admin/challenges`
- `POST /v1/admin/challenge-versions/:id/publish`
- `GET /v1/admin/users`
- `POST /v1/admin/users`
- `PATCH /v1/admin/users/:id/status`
- `PATCH /v1/admin/users/:id`
- `PATCH /v1/admin/users/:id/role`
- `DELETE /v1/admin/users/:id`
- `POST /v1/admin/databases/scan`
- `POST /v1/admin/databases/import`
- `GET /v1/admin/config`
- `PUT /v1/admin/config`
- `POST /v1/admin/config/reset`
- `GET /v1/admin/system/jobs`
- `GET /v1/admin/system/health`

## API Verification Results

### Commands Run

```bash
pnpm --filter @sqlcraft/api test
pnpm --filter @sqlcraft/api typecheck
pnpm --filter @sqlcraft/web typecheck
pnpm --filter @sqlcraft/web exec eslint 'src/app/(app)/explore/page.tsx' 'src/app/(app)/dashboard/page.tsx' 'src/app/(app)/explore/[dbId]/page.tsx' 'src/app/(app)/tracks/page.tsx' 'src/app/(app)/tracks/[trackId]/lessons/[lessonId]/page.tsx' 'src/lib/database-catalog.ts' 'src/app/(app)/tracks/[trackId]/lessons/[lessonId]/page.test.tsx'
pnpm --filter @sqlcraft/web exec vitest run 'src/app/(app)/tracks/[trackId]/lessons/[lessonId]/page.test.tsx'
```

### Results

- API tests: passed
  - 12 test files
  - 129 tests
- API typecheck: passed
- Web typecheck: passed
- Web lint on touched files: passed
- Targeted lesson page test: passed

## Manual HTTP Verification By Screen

### Environment used

- Web base URL: `http://localhost:3000`
- API base URL: `http://localhost:4000`
- Stack used for the final verification: `docker-compose.dev.yml` with API, web, worker, Postgres, Redis, and MinIO
- API container now runs `pnpm db:migrate` on startup before `pnpm dev`
- API and worker containers now share `QUEUE_PREFIX=sqlcraft:docker-dev`, isolating Docker job queues from host-local worker processes
- One false-negative during the audit came from a stale host-side worker process consuming Redis jobs outside Docker; that process was stopped before the final query-execution verification

### Dashboard / Explore / Tracks

- PASS `GET /v1/databases`
- PASS `GET /v1/databases/:databaseId`
- PASS `GET /v1/tracks`
- PASS `GET /v1/tracks/:trackId`
- PASS `GET /v1/learning-sessions`
- PASS `GET /v1/query-executions`

### Database Detail / Lesson Detail

- PASS `POST /v1/databases/sessions`
- PASS `POST /v1/learning-sessions`
- PASS `GET /v1/learning-sessions/:sessionId`
- PASS `GET /v1/learning-sessions/:sessionId/schema`
- PASS `GET /v1/learning-sessions/:sessionId/schema-diff` returns the expected pre-ready validation error when the sandbox is not ready
- PASS sandbox provisioning now completes and the session transitions to `active`
- PASS `POST /v1/query-executions` succeeds on an active sandbox session
- PASS `POST /v1/sandboxes/:sessionId/reset`
- PASS `POST /v1/learning-sessions/:sessionId/end`

### Contributor / Challenge Screens

- PASS `POST /v1/challenges/validate`
- PASS `POST /v1/challenges`
- PASS `GET /v1/challenges/mine`
- PASS `GET /v1/challenges/:id/draft`
- PASS `POST /v1/challenges/:id/versions`
- PASS `GET /v1/admin/challenges`
- PASS `POST /v1/admin/challenge-versions/:id/review` with `decision: "approve"`
- PASS `GET /v1/challenges`
- PASS `GET /v1/challenge-versions/:id`
- PASS `GET /v1/challenge-versions/:id/leaderboard`
- PASS `GET /v1/challenge-attempts`
- NOTE challenge-attempt submission was not re-run in the final pass, but its previously blocked dependency path is now verified: provisioning and query execution both succeed

### Lab / History

- PASS `GET /v1/query-executions`
- PASS `GET /v1/learning-sessions/:sessionId/query-executions`
- PASS `GET /v1/users/me/query-history`
- PASS `GET /v1/users/me/sessions`
- PASS lab execution flow is available in the current stack; live query execution returned a successful result preview

### Settings

- PASS `PATCH /v1/users/me`
- PASS `POST /v1/users/me/change-password`
- PASS `POST /v1/users/me/avatar`
  - verified in Docker after separating the internal MinIO endpoint (`minio:9000`) from the public presign URL host (`localhost:9000`)

### Admin Content

- PASS `POST /v1/admin/lessons`
- PASS `POST /v1/admin/lesson-versions`
- PASS `GET /v1/admin/lessons/:id/versions`
- PASS `GET /v1/admin/lesson-versions/:id`
- PASS `POST /v1/admin/lesson-versions/:id/publish`
- PASS `GET /v1/admin/challenges`
- PASS `POST /v1/admin/challenge-versions/:id/review`

### Admin User Management

- PASS `GET /v1/admin/users`
- PASS `POST /v1/admin/users` with `role: "user"`
  - verified response now returns `roles: ["learner"]`
- PASS `POST /v1/admin/users` with `role: "admin"`
- PASS `PATCH /v1/admin/users/:id`
- PASS `PATCH /v1/admin/users/:id/status`
- PASS disabled-user login is blocked with `code: "1005"` / `Account is not active`
- PASS `DELETE /v1/admin/users/:id`
- NOTE the external admin/frontend contract still uses `"user"`, but storage is now normalized to the live non-admin role `learner`
- PASS `GET /v1/users/me` for the seeded standard account now returns `roles: ["learner"]`

### Admin Rankings / System

- PASS `GET /v1/leaderboard`
- PASS `GET /v1/admin/config`
- PASS `PUT /v1/admin/config`
- PASS `POST /v1/admin/config/reset`
- PASS `GET /v1/admin/system/health`
- PASS `GET /v1/admin/system/jobs`

## Runtime Fixes Verified

### 1. Sandbox provisioning and query execution now work in the containerized stack

- Root cause fixed in code:
  - `services/worker/src/dataset-loader.ts` did not classify `INTEGER` columns as numeric, so synthetic seed generation emitted text for `order_items.quantity`
- Runtime false-negative also removed:
  - a stale host-side worker process outside Docker was consuming `query-execution` jobs and could not resolve Docker container hostnames
- Final evidence:
  - worker log shows `Seeded table from rowCounts metadata` for `order_items`
  - worker log shows `Sandbox ready`
  - live `POST /v1/query-executions` returned a completed execution with `status: "succeeded"`

### 2. Admin config persistence now works after restoring the migration path

- Root cause:
  - the migration file already existed, but the API container was not applying migrations when started directly through Docker Compose
- Fix:
  - `docker-compose.dev.yml` now starts the API with `pnpm db:migrate && pnpm dev`
- Final evidence:
  - `admin_configs` exists in Postgres
  - `GET`, `PUT`, and `POST reset` on `/v1/admin/config` now return success

### 3. External `"user"` role input is now bridged to the live stored role model

- Fixes:
  - admin/auth flows now normalize external `"user"` to stored role `learner`
  - seed data now assigns the standard test account to `learner`
- Final evidence:
  - `POST /v1/admin/users` with `role: "user"` returns success and stored roles `["learner"]`
  - `GET /v1/users/me` for `user@sqlcraft.dev` returns `roles: ["learner"]`

### 4. Global leaderboard routing is now implemented

- Fix:
  - added `GET /v1/leaderboard` in the challenges module with period + limit query support
- Final evidence:
  - `GET /v1/leaderboard` now returns HTTP 200

### 5. Avatar upload now works in Docker

- Root cause:
  - the API container inherited `.env` with `STORAGE_ENDPOINT=http://localhost:9000`, so the upload path tried to reach MinIO on the API container itself instead of the MinIO service
- Fix:
  - Docker Compose now sets `STORAGE_ENDPOINT=http://minio:9000` and `STORAGE_PUBLIC_URL=http://localhost:9000` for the API container
- Final evidence:
  - `POST /v1/users/me/avatar` now returns success and a valid MinIO presigned URL

## Per-Module Status

| Module | Route status | Automated evidence today | Main gap | Verdict |
| --- | --- | --- | --- | --- |
| Auth | Implemented | compile only | no auth route tests found | implemented, under-verified |
| Databases | Implemented | `databases.service.test.ts` passed | no HTTP contract tests | implemented, partially proven |
| Tracks | Implemented | `tracks.service.test.ts` passed | no route tests | implemented, partially proven |
| Lessons | Implemented | `lessons.service.test.ts` passed | no route tests | implemented, partially proven |
| Sessions | Implemented | `sessions.service.test.ts` passed | no route tests | implemented, partially proven |
| Queries | Implemented | `queries.service.test.ts` passed | no route tests | implemented, partially proven |
| Challenges | Implemented | `challenges.service.test.ts` passed | no route tests, no review-route contract tests | implemented, partially proven |
| Sandboxes | Implemented | `sandboxes.service.test.ts` passed | no route tests | implemented, partially proven |
| Users | Implemented | compile only | no dedicated module tests found | implemented, weakly proven |
| Admin | Implemented | `admin.service.test.ts` and `sql-dump-scan.test.ts` passed | no route tests, no end-to-end multipart/import coverage | implemented, partially proven |

## API Spec Drift

`docs/api-spec.md` is behind the live API.

### Confirmed Drift

1. Pagination wording still says `page_size`, while live APIs generally use `page` and `limit`.
2. The spec does not currently document:
   - database explorer endpoints
   - user profile/session/history endpoints
   - `GET /v1/auth/me`
   - most challenge draft/review endpoints
   - admin config/system/user-management endpoints
   - session schema endpoint
   - global query history endpoint
3. Because of that drift, the spec is not reliable enough yet as the single source of truth for testing.

## Current Conclusion On “Are All APIs Complete?”

Short answer: still no, not yet at a quality bar that should be called complete.

### What can be said with evidence

- All major API areas exist in code and compile.
- Service-layer tests are healthy for most core business modules.
- No obvious backend mock API layer or stub router was found.

### What prevents a “complete” verdict

- Auth and Users are especially under-tested at the HTTP layer.
- Most modules lack route-contract coverage for:
  - validation failures
  - authorization failures
  - response schema stability
  - multipart behavior
  - async state transitions
- The written API spec is incomplete and outdated.
- Most modules still lack route-contract coverage for negative cases and async state transitions.
- The concrete runtime blockers found in this audit slice were fixed, but they are currently proven mostly by manual HTTP verification plus service/unit tests, not by durable end-to-end automation.

## Priority Next Actions

1. Add route-contract tests for Auth and Users first.
2. Add HTTP tests for Databases, Sessions, Queries, Challenges, and Admin multipart/import flows.
3. Add end-to-end coverage for sandbox provisioning, query execution, and challenge-attempt submission.
4. Add a startup/health assertion that fails loudly if a host-side worker is consuming Redis jobs outside the intended Docker topology.
5. Make admin user creation fully transactional even when role assignment fails unexpectedly for reasons beyond role lookup.
6. Update `docs/api-spec.md` to match the 66 live route definitions.
7. Add a generated or semi-generated API report job so this audit becomes repeatable.
