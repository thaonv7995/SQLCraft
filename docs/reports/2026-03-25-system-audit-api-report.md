# System Audit And API Report

Date: 2026-03-25

## Executive Summary

- Frontend feature surface discovered: 32 page routes in `apps/web/src/app`.
- API surface discovered: 65 route definitions across 10 router modules.
- No runtime mock API implementation was found in the backend.
- Runtime mock data and fallback catalog behavior were found in the frontend and removed in this audit slice.
- API implementation exists across all registered router modules, but the system is not yet at a level where every API can be called “fully complete”.
- Main reason: the backend currently proves business logic mostly through service tests, not HTTP contract/integration tests.

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

Short answer: no, not at a quality bar that should be called complete.

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

## Priority Next Actions

1. Add route-contract tests for Auth and Users first.
2. Add HTTP tests for Databases, Sessions, Queries, Challenges, and Admin multipart/import flows.
3. Update `docs/api-spec.md` to match the 65 live route definitions.
4. Add a generated or semi-generated API report job so this audit becomes repeatable.
