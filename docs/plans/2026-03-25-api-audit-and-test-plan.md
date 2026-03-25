# System API Audit And Test Plan
> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** remove runtime hardcoded/mock data, verify which APIs are actually complete, and establish a repeatable API test plan that produces a per-endpoint report instead of relying on assumptions.

**Architecture:** Next.js App Router frontend consuming a Fastify API, with worker-backed sandbox/session/query execution flows and admin content management endpoints.

**Tech Stack:** TypeScript, Next.js, TanStack Query, Fastify, Vitest, ESLint, pnpm.

---

## Context Snapshot

- Frontend page inventory: 32 `page.tsx` routes under `apps/web/src/app`.
- API route inventory: 65 route definitions across 10 router modules under `apps/api/src/modules`.
- API automated tests today: 9 module test files, all service-focused.
- Web automated tests today: 5 page test files, mostly mocked-client UI tests.
- Current API spec drift: `docs/api-spec.md` documents only a subset of the live routes and still uses outdated pagination wording (`page_size` vs `limit`).

## What Was Fixed In This Audit Slice

1. Removed runtime placeholder database catalog usage from:
   - `apps/web/src/app/(app)/dashboard/page.tsx`
   - `apps/web/src/app/(app)/explore/page.tsx`
   - `apps/web/src/app/(app)/explore/[dbId]/page.tsx`
2. Removed placeholder track catalog usage from:
   - `apps/web/src/app/(app)/tracks/page.tsx`
3. Deleted the now-unused hardcoded database catalog from:
   - `apps/web/src/lib/database-catalog.ts`
4. Replaced stale challenge CTA placeholder copy in:
   - `apps/web/src/app/(app)/tracks/[trackId]/lessons/[lessonId]/page.tsx`

## Workstream 1: API Contract Truth

1. Update `docs/api-spec.md` to match the live routers.
2. Split the spec by module so changes are reviewable:
   - Auth
   - Databases
   - Tracks / Lessons
   - Sessions / Queries / Sandboxes
   - Challenges
   - Users
   - Admin
3. Add explicit request/response examples for async flows:
   - create session
   - create database sandbox session
   - submit query
   - submit challenge attempt
   - sandbox reset
4. Mark endpoints that are admin-only, optional-auth, or multipart.

## Workstream 2: HTTP Contract Test Harness

1. Add a reusable Fastify app test harness that boots the API without external network dependencies.
2. Add helpers for:
   - authenticated `user` requests
   - authenticated `admin` requests
   - anonymous requests
   - seeded fixtures for track / lesson / database / session graphs
3. Separate route-contract tests from service tests so failures point to the right layer.

## Workstream 3: Route Test Matrix

### Auth

1. `POST /v1/auth/register`
   - happy path
   - duplicate email / username
   - validation failures
2. `POST /v1/auth/login`
   - valid credentials
   - wrong password
   - disabled user
3. `POST /v1/auth/logout`
4. `POST /v1/auth/refresh`
5. `GET /v1/auth/me`

### Databases

1. `GET /v1/databases`
   - pagination
   - domain / scale / difficulty filters
2. `GET /v1/databases/:databaseId`
   - id lookup
   - slug lookup
   - 404
3. `POST /v1/databases/sessions`
   - valid scale
   - unavailable scale
   - upscale rejection

### Tracks / Lessons

1. `GET /v1/tracks`
2. `GET /v1/tracks/:trackId`
3. `GET /v1/lessons/:lessonId`
4. `GET /v1/lesson-versions/:versionId`

### Sessions / Queries / Sandboxes

1. `GET /v1/learning-sessions`
2. `POST /v1/learning-sessions`
3. `GET /v1/learning-sessions/:sessionId`
4. `GET /v1/learning-sessions/:sessionId/schema`
5. `GET /v1/learning-sessions/:sessionId/schema-diff`
6. `POST /v1/learning-sessions/:sessionId/end`
7. `GET /v1/query-executions`
8. `POST /v1/query-executions`
9. `GET /v1/query-executions/:id`
10. `GET /v1/learning-sessions/:sessionId/query-executions`
11. `GET /v1/sandboxes/:sandboxId`
12. `POST /v1/sandboxes/:sessionId/reset`

### Challenges

1. published list
2. draft list for current user
3. create draft
4. validate draft
5. fetch editable draft
6. create draft version
7. fetch published version
8. submit attempt
9. list attempts
10. get attempt detail
11. leaderboard
12. admin review queue
13. admin review action

### Users

1. `GET /v1/users/me`
2. `PATCH /v1/users/me`
3. `POST /v1/users/me/avatar`
4. `POST /v1/users/me/change-password`
5. `GET /v1/users/me/sessions`
6. `GET /v1/users/me/query-history`

### Admin

1. tracks create/update
2. lessons create
3. lesson versions create/list/detail/publish
4. challenges create/publish
5. users list/create/update/status/role/delete
6. database scan/import
7. config get/update/reset
8. system jobs
9. system health

## Workstream 4: End-To-End Flow Coverage

1. User flow
   - register/login
   - browse database catalog
   - create sandbox session
   - run query
   - submit challenge attempt
2. Admin flow
   - create track
   - create lesson
   - create lesson version
   - publish lesson version
   - create challenge
   - publish challenge version
3. Operational flow
   - sandbox reset
   - session end
   - admin system health/jobs access

## Reporting Rules

1. Every route must end up in one of four states:
   - `verified`
   - `implemented but only service-tested`
   - `implemented but undocumented`
   - `missing or broken`
2. Reports must separate:
   - code existence
   - compile status
   - service-test status
   - HTTP contract status
   - end-to-end status
3. No endpoint should be called “complete” until it has at least:
   - schema/validation coverage
   - auth/permission coverage where relevant
   - happy path
   - one failure-path assertion

## Exit Criteria

1. Runtime UI no longer fabricates database/track data on API failure.
2. API spec matches all live routes.
3. Each router module has dedicated HTTP contract tests.
4. The final report can show a truthful per-endpoint status without inference.
