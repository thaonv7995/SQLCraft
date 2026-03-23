# SQLCraft — Code Conventions

> **Authority:** This document is the single source of truth for code style, architecture patterns, and naming in the SQLCraft monorepo. All PRs must comply before merge.

---

## Table of Contents

1. [Tech Stack Decisions](#1-tech-stack-decisions)
2. [Project Structure](#2-project-structure)
3. [Backend Architecture Layers](#3-backend-architecture-layers)
4. [TypeScript Standards](#4-typescript-standards)
5. [API Standards](#5-api-standards)
6. [Error Code Catalog](#6-error-code-catalog)
7. [Environment Variables](#7-environment-variables)
8. [Frontend Conventions](#8-frontend-conventions)
9. [Database & ORM](#9-database--orm)
10. [Naming Conventions](#10-naming-conventions)
11. [File Organization](#11-file-organization)

---

## 1. Tech Stack Decisions

### Backend: Fastify (not NestJS)

**Decision:** The backend uses **Fastify v4**, not NestJS.

**Rationale:**
- Fastify is significantly faster than NestJS/Express (up to 3× throughput)
- Lower memory footprint — critical when running alongside many sandbox containers
- Type-safe plugin system via TypeScript augmentation
- Built-in Zod-compatible JSON schema validation
- Swagger integration is first-class

NestJS was listed in earlier design sketches but was **not adopted** — Fastify was chosen at implementation. This document supersedes any prior references to NestJS.

### Frontend: Next.js 14 App Router

**Decision:** Use **Next.js 14 App Router** exclusively. No Pages Router.

- Server Components by default; add `"use client"` only when necessary
- All state: **Zustand** (client) + **TanStack Query v5** (server state)
- Forms: **react-hook-form** + **zod** resolver only
- No Redux, MobX, or class-based state

### Database ORM: Drizzle ORM

**Decision:** **Drizzle ORM** with `node-postgres` driver. Not Prisma.

- Schema is the single source of truth — all types are inferred from it
- Migrations are generated SQL files, versioned in `apps/api/src/db/migrations/`
- Raw SQL via `sql` tag only when Drizzle query builder is insufficient

---

## 2. Project Structure

```
sqlcraft/
├── apps/
│   ├── api/                    # Fastify backend
│   │   └── src/
│   │       ├── db/
│   │       │   ├── schema/     # Drizzle schema definitions (source of truth)
│   │       │   ├── migrations/ # Generated SQL migration files
│   │       │   ├── repositories/ # Data access layer (Drizzle queries only)
│   │       │   └── seed.ts
│   │       ├── modules/        # Feature modules (replaces flat routes/)
│   │       │   └── auth/
│   │       │       ├── auth.router.ts      # Fastify route registration + Swagger schema
│   │       │       ├── auth.handler.ts     # Request/response orchestration
│   │       │       ├── auth.service.ts     # Business logic
│   │       │       ├── auth.schema.ts      # Zod schemas for this module
│   │       │       └── auth.types.ts       # Module-local types
│   │       ├── lib/
│   │       │   ├── response.ts     # Standardized response helpers
│   │       │   ├── errors.ts       # AppError subclasses
│   │       │   └── logger.ts       # Pino instance
│   │       ├── plugins/
│   │       │   └── auth.ts         # JWT authenticate/authorize decorators
│   │       ├── middleware/
│   │       │   └── error-handler.ts
│   │       └── index.ts
│   └── web/                    # Next.js 14 frontend
│       └── src/
│           ├── app/            # App Router pages
│           ├── components/
│           │   ├── ui/         # Primitive design-system components
│           │   ├── layout/     # Navbar, Sidebar, etc.
│           │   └── [feature]/  # Feature-specific components
│           ├── hooks/          # Custom React hooks
│           ├── lib/
│           │   ├── api.ts      # Typed Axios client
│           │   └── utils.ts
│           ├── stores/         # Zustand stores
│           └── types/          # Frontend-local types (not shared)
├── services/
│   └── worker/
│       └── src/
│           ├── jobs/           # One file per job type
│           ├── queues/         # Queue definitions
│           └── index.ts
└── packages/
    └── types/
        └── src/
            └── index.ts        # Shared types + ApiCode enum
```

---

## 3. Backend Architecture Layers

Code in `apps/api/src/modules/` follows a strict 4-layer architecture. **No business logic in routers. No DB queries in handlers.**

```
HTTP Request
    │
    ▼
[Router]          — Fastify route registration, Swagger schema, onRequest hooks
    │
    ▼
[Handler]         — Parse & validate input, call service, shape response
    │
    ▼
[Service]         — Business logic, orchestration, throws AppErrors
    │
    ▼
[Repository]      — Drizzle queries only, no logic, returns raw DB rows
    │
    ▼
[DB Schema]       — Drizzle table definitions, type inference
```

### 3.1 Router (`*.router.ts`)

Responsibilities:
- Register routes with Fastify
- Declare Swagger/OpenAPI schema (tags, summary, request/response body shapes)
- Attach `onRequest` lifecycle hooks (`authenticate`, `authorize`)
- Delegate all work to the handler — **zero business logic**

```typescript
// modules/tracks/tracks.router.ts
import type { FastifyInstance } from 'fastify';
import type { ListTracksQuery, GetTrackParams } from './tracks.schema';
import { listTracksHandler, getTrackHandler } from './tracks.handler';

export default async function tracksRouter(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: ListTracksQuery }>(
    '/v1/tracks',
    {
      onRequest: [fastify.optionalAuthenticate],
      schema: {
        tags: ['Tracks'],
        summary: 'List published tracks',
        querystring: {
          type: 'object',
          properties: {
            page:  { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    listTracksHandler,
  );

  fastify.get<{ Params: GetTrackParams }>(
    '/v1/tracks/:trackId',
    {
      onRequest: [fastify.optionalAuthenticate],
      schema: {
        tags: ['Tracks'],
        summary: 'Get a single track with lessons summary',
        params: {
          type: 'object',
          required: ['trackId'],
          properties: {
            trackId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    getTrackHandler,
  );
}
```

### 3.2 Handler (`*.handler.ts`)

Responsibilities:
- Validate input with Zod (parse request body/params/query)
- Call one or more service methods
- Build the response using `success()` / `created()` helpers
- **No DB queries. No business rules.**

```typescript
// modules/tracks/tracks.handler.ts
import type { FastifyRequest, FastifyReply } from 'fastify';
import { ListTracksQuerySchema, GetTrackParamsSchema } from './tracks.schema';
import type { ListTracksQuery, GetTrackParams } from './tracks.schema';
import { TracksService } from './tracks.service';
import { success, MESSAGES } from '../../lib/response';

const tracksService = new TracksService();

export async function listTracksHandler(
  request: FastifyRequest<{ Querystring: ListTracksQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const query = ListTracksQuerySchema.parse(request.query);
  const result = await tracksService.listPublishedTracks(query);
  return reply.send(success(result, MESSAGES.TRACKS_RETRIEVED));
}

export async function getTrackHandler(
  request: FastifyRequest<{ Params: GetTrackParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { trackId } = GetTrackParamsSchema.parse(request.params);
  const track = await tracksService.getTrackById(trackId);
  return reply.send(success(track, MESSAGES.TRACK_RETRIEVED));
}
```

### 3.3 Service (`*.service.ts`)

Responsibilities:
- Business logic and orchestration
- Permission checks that require business context
- Calls repository methods to fetch/mutate data
- Throws typed `AppError` subclasses — **never raw `new Error()`**
- **No Fastify types. No `request` or `reply`.**

```typescript
// modules/tracks/tracks.service.ts
import type { ListTracksQuery } from './tracks.schema';
import type { TrackWithLessonCount } from './tracks.types';
import { TracksRepository } from '../../db/repositories/tracks.repository';
import { NotFoundError } from '../../lib/errors';

export class TracksService {
  private readonly repo = new TracksRepository();

  async listPublishedTracks(query: ListTracksQuery): Promise<{
    items: TrackWithLessonCount[];
    meta: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const { items, total } = await this.repo.findPublished(query);
    return {
      items,
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  async getTrackById(trackId: string): Promise<TrackWithLessonCount> {
    const track = await this.repo.findByIdPublished(trackId);
    if (!track) {
      throw new NotFoundError('Track not found');
    }
    return track;
  }
}
```

### 3.4 Repository (`db/repositories/*.repository.ts`)

Responsibilities:
- Drizzle ORM queries only
- Returns typed objects inferred from the Drizzle schema
- **No business logic. No error throwing. Returns `null` when not found.**

```typescript
// db/repositories/tracks.repository.ts
import { eq, and, count, asc } from 'drizzle-orm';
import { getDb, schema } from '../index';
import type { TrackWithLessonCount } from '../../modules/tracks/tracks.types';

export class TracksRepository {
  private get db() {
    return getDb();
  }

  async findPublished(opts: {
    page: number;
    limit: number;
  }): Promise<{ items: TrackWithLessonCount[]; total: number }> {
    const offset = (opts.page - 1) * opts.limit;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(schema.tracks)
        .where(eq(schema.tracks.status, 'published'))
        .orderBy(asc(schema.tracks.sortOrder))
        .limit(opts.limit)
        .offset(offset),
      this.db
        .select({ count: count() })
        .from(schema.tracks)
        .where(eq(schema.tracks.status, 'published')),
    ]);

    const items: TrackWithLessonCount[] = rows.map((t) => ({ ...t, lessonCount: 0 }));
    return { items, total: totalRows[0]?.count ?? 0 };
  }

  async findByIdPublished(trackId: string): Promise<TrackWithLessonCount | null> {
    const [row] = await this.db
      .select()
      .from(schema.tracks)
      .where(and(eq(schema.tracks.id, trackId), eq(schema.tracks.status, 'published')))
      .limit(1);

    return row ? { ...row, lessonCount: 0 } : null;
  }
}
```

### 3.5 Schema (`*.schema.ts`)

All Zod schemas and their **inferred types** live here.

```typescript
// modules/tracks/tracks.schema.ts
import { z } from 'zod';

export const ListTracksQuerySchema = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const GetTrackParamsSchema = z.object({
  trackId: z.string().uuid('trackId must be a valid UUID'),
});

// Inferred types — import these in handler/service, NOT the z.object literal
export type ListTracksQuery = z.infer<typeof ListTracksQuerySchema>;
export type GetTrackParams  = z.infer<typeof GetTrackParamsSchema>;
```

### 3.6 Types (`*.types.ts`)

Module-local TypeScript interfaces that don't belong in `@sqlcraft/types`.

```typescript
// modules/tracks/tracks.types.ts
import type { InferSelectModel } from 'drizzle-orm';
import type { schema } from '../../db';

export type TrackRow = InferSelectModel<typeof schema.tracks>;

export interface TrackWithLessonCount extends TrackRow {
  lessonCount: number;
}
```

---

## 4. TypeScript Standards

### 4.1 Always type Fastify generics

Never use bare `async (request, reply)`. Always declare Generics on the route method.

```typescript
// ❌ Bad
fastify.get('/v1/tracks/:trackId', async (request, reply) => {
  const { trackId } = request.params as { trackId: string }; // unsafe cast
});

// ✅ Good
fastify.get<{ Params: GetTrackParams }>(
  '/v1/tracks/:trackId',
  async (request: FastifyRequest<{ Params: GetTrackParams }>, reply: FastifyReply) => {
    const { trackId } = request.params; // inferred, no cast needed
  },
);
```

Fastify generic slots:
```typescript
fastify.post<{
  Body:        MyBodyType;
  Params:      MyParamsType;
  Querystring: MyQueryType;
  Reply:       MyReplyType;
}>('/route', handler);
```

### 4.2 No implicit `any`

`tsconfig.json` sets `"strict": true`. Disable rules apply only with explicit `// eslint-disable-next-line` and a comment explaining why.

```typescript
// ❌ Bad
const data: any = response.data;

// ✅ Good
const data: TrackWithLessonCount = response.data;
// or
const data = response.data as TrackWithLessonCount; // only after runtime check
```

### 4.3 Prefer `interface` for object shapes, `type` for unions/intersections

```typescript
// ✅ Shapes → interface
interface CreateTrackDto {
  slug: string;
  title: string;
  description?: string;
}

// ✅ Unions → type
type TrackStatus = 'draft' | 'published' | 'archived';

// ✅ Intersections → type
type TrackWithMeta = TrackRow & { lessonCount: number };
```

### 4.4 Explicit return types on exported functions

```typescript
// ❌ Bad
export async function listTracks(query: ListTracksQuery) {
  // return type inferred
}

// ✅ Good
export async function listTracks(query: ListTracksQuery): Promise<PaginatedResult<Track>> {
  // return type explicit
}
```

### 4.5 Prefer `unknown` over `any` for catch clauses

```typescript
// ❌ Bad
} catch (e: any) {
  console.error(e.message);
}

// ✅ Good
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err }, message);
}
```

### 4.6 Use `satisfies` for config objects

```typescript
// ✅ Good — validates shape without widening the type
const config = {
  host: 'localhost',
  port: 5432,
} satisfies Partial<PoolConfig>;
```

---

## 5. API Standards

### 5.1 Versioning

All routes must be prefixed with `/v1/`. When breaking changes are needed, introduce `/v2/` as a separate router, keeping v1 alive.

```typescript
// ✅
fastify.get('/v1/tracks', ...);
fastify.get('/v2/tracks', ...); // breaking change
```

### 5.2 Response Envelope

**Every** API response — success or error — uses this envelope:

```typescript
// packages/types/src/index.ts
export interface ApiResponse<T = unknown> {
  success: boolean;
  code: string;   // 4-digit string from ApiCode enum
  message: string;
  data: T | null;
}
```

**Success examples:**
```json
// Single resource
{ "success": true, "code": "0000", "message": "Track retrieved successfully", "data": { "id": "...", "title": "..." } }

// List with pagination
{ "success": true, "code": "0000", "message": "Tracks retrieved successfully",
  "data": { "items": [...], "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 } } }

// Void operation
{ "success": true, "code": "0000", "message": "Logged out successfully", "data": null }

// Created resource
{ "success": true, "code": "0001", "message": "Track created successfully", "data": { "id": "..." } }
```

**Error example:**
```json
{ "success": false, "code": "2002", "message": "Track not found", "data": null }
```

### 5.3 Response helpers (mandatory use)

Use only these helpers from `apps/api/src/lib/response.ts`:

```typescript
import { success, created, error, MESSAGES } from '../lib/response';

// ✅ Success (200)
return reply.send(success(data, MESSAGES.TRACK_RETRIEVED));

// ✅ Created (201)
return reply.status(201).send(created(data, MESSAGES.TRACK_CREATED));

// ✅ Error (any 4xx/5xx) — prefer throwing AppError instead
return reply.status(404).send(error(ApiCode.NOT_FOUND, 'Track not found'));
```

Prefer **throwing** `AppError` over manually building error responses — the global error handler covers it.

### 5.4 Pagination

List endpoints use `page` + `limit` (not `offset`) querystring params. Response always includes `meta`:

```typescript
interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
```

### 5.5 Timestamps

All timestamps are ISO 8601 strings in UTC: `"2024-03-23T14:30:00.000Z"`. DB returns `Date`; always serialize with `.toISOString()` before sending.

---

## 6. Error Code Catalog

Error codes are **4-digit numeric strings** defined in `packages/types/src/index.ts`. Import `ApiCode` everywhere — never hardcode a string like `'1001'`.

```typescript
// packages/types/src/index.ts
export const ApiCode = {
  // ── 0xxx Success ────────────────────────────────────
  SUCCESS:                    '0000',
  CREATED:                    '0001',
  ACCEPTED:                   '0002',

  // ── 1xxx Auth ────────────────────────────────────────
  UNAUTHORIZED:               '1001',  // No/missing token
  FORBIDDEN:                  '1002',  // Valid token, insufficient role
  TOKEN_EXPIRED:              '1003',  // JWT expired
  TOKEN_INVALID:              '1004',  // Malformed / tampered JWT
  INVALID_CREDENTIALS:        '1005',  // Wrong email/password

  // ── 2xxx Validation & Resource ───────────────────────
  VALIDATION_ERROR:           '2001',  // Zod / input validation failed
  NOT_FOUND:                  '2002',  // Resource does not exist
  ALREADY_EXISTS:             '2003',  // Unique constraint violation
  CONFLICT:                   '2004',  // State conflict (e.g. already ended)

  // ── 3xxx Session & Sandbox ───────────────────────────
  SESSION_NOT_READY:          '3001',  // Session still provisioning
  SESSION_EXPIRED:            '3002',  // Session TTL exceeded
  SESSION_NOT_FOUND:          '3003',
  SANDBOX_NOT_READY:          '3004',  // Sandbox still provisioning
  SANDBOX_PROVISIONING_FAILED:'3005',
  SANDBOX_BUSY:               '3006',  // Sandbox processing another query

  // ── 4xxx Query Execution ──────────────────────────────
  QUERY_BLOCKED:              '4001',  // Blocked statement type (DROP, etc.)
  QUERY_TIMEOUT:              '4002',  // Exceeded statement_timeout
  QUERY_EXECUTION_FAILED:     '4003',  // PG returned an error
  QUERY_SYNTAX_ERROR:         '4004',  // SQL syntax error
  QUERY_RESULT_TOO_LARGE:     '4005',  // Result exceeds row/byte cap

  // ── 5xxx Content ──────────────────────────────────────
  CONTENT_NOT_PUBLISHED:      '5001',  // Draft or archived content
  CONTENT_VERSION_NOT_FOUND:  '5002',

  // ── 6xxx Rate Limiting ────────────────────────────────
  RATE_LIMITED:               '6001',

  // ── 9xxx Server Errors ────────────────────────────────
  INTERNAL_ERROR:             '9001',  // Unhandled exception
  SERVICE_UNAVAILABLE:        '9002',  // Dependency (DB, Redis) down
} as const;

export type ApiCode = typeof ApiCode[keyof typeof ApiCode];
```

> **Important:** `ApiCode` is exported as a `const` object (not an `enum`) to avoid TypeScript enum emit issues in ESM and allow `Object.values(ApiCode)` lookups.

### HTTP status → ApiCode mapping

| HTTP | ApiCode | When |
|------|---------|------|
| 200 | `0000` | Standard success |
| 201 | `0001` | Resource created |
| 202 | `0002` | Async job accepted |
| 400 | `2001` | Input validation failed |
| 401 | `1001` `1003` `1004` | Missing/expired/invalid token |
| 403 | `1002` `4001` | Forbidden / blocked query |
| 404 | `2002` `3003` `5002` | Not found |
| 409 | `2003` `2004` `3001` `3006` | Conflict / not ready |
| 429 | `6001` | Rate limited |
| 500 | `9001` | Internal error |
| 503 | `9002` | Service unavailable |

---

## 7. Environment Variables

### 7.1 Naming

- Screaming snake case: `DATABASE_URL`, not `databaseUrl`
- Prefixed by service when ambiguous: `SANDBOX_DB_HOST` vs `DATABASE_URL`
- Feature flags: `FEATURE_XYZ_ENABLED=true`

### 7.2 Required variables

All variables used in code must exist in `.env.example`. Build fails if a required variable is missing. Use this pattern:

```typescript
// apps/api/src/lib/config.ts
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV:          z.enum(['development', 'test', 'production']).default('development'),
  API_PORT:          z.coerce.number().default(4000),
  DATABASE_URL:      z.string().url(),
  REDIS_URL:         z.string().url(),
  JWT_SECRET:        z.string().min(32),
  JWT_EXPIRES_IN:    z.string().default('15m'),
  STORAGE_ENDPOINT:  z.string().url(),
  STORAGE_ACCESS_KEY: z.string(),
  STORAGE_SECRET_KEY: z.string(),
  STORAGE_BUCKET:    z.string().default('sqlcraft'),
  SANDBOX_DB_HOST:   z.string(),
  SANDBOX_DB_PORT:   z.coerce.number().default(5432),
  SANDBOX_DB_USER:   z.string(),
  SANDBOX_DB_PASSWORD: z.string(),
  SANDBOX_MAX_QUERY_TIME_MS:  z.coerce.number().default(30000),
  SANDBOX_MAX_ROWS_PREVIEW:   z.coerce.number().default(500),
  RATE_LIMIT_WINDOW_MS:       z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS:    z.coerce.number().default(100),
});

export const config = EnvSchema.parse(process.env);
export type Config = z.infer<typeof EnvSchema>;
```

### 7.3 Frontend env variables

Next.js env vars follow these rules:

| Prefix | Exposed to | Use for |
|--------|-----------|---------|
| `NEXT_PUBLIC_` | Browser + Server | API base URL, feature flags |
| *(none)* | Server only | Secret keys (never use in frontend) |

```bash
# ✅ Safe — sent to browser
NEXT_PUBLIC_API_URL=http://localhost:4000

# ❌ Never expose secrets to browser
# NEXT_PUBLIC_JWT_SECRET=xxx  ← WRONG
```

### 7.4 `.env.example` must stay current

Any PR adding a new env variable **must** update `.env.example` and document the variable's purpose with a comment.

---

## 8. Frontend Conventions

### 8.1 Component typing

All React components must have explicit prop types. Never use `React.FC` — use plain function declarations with an explicit `Props` interface.

```typescript
// ❌ Bad — no prop types, uses FC
const TrackCard: React.FC = ({ title }) => { ... }

// ✅ Good
interface TrackCardProps {
  title: string;
  description?: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  lessonCount: number;
  onStart: () => void;
}

export function TrackCard({ title, description, difficulty, lessonCount, onStart }: TrackCardProps) {
  ...
}
```

### 8.2 Event handler typing

```typescript
// ❌ Bad — event type implicit
const handleChange = (e) => { ... }

// ✅ Good
const handleChange = (e: React.ChangeEvent<HTMLInputElement>): void => { ... }
const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => { ... }
const handleClick  = (e: React.MouseEvent<HTMLButtonElement>): void => { ... }
```

### 8.3 `useState` typing

```typescript
// ❌ Bad — inferred as string | null
const [query, setQuery] = useState(null);

// ✅ Good
const [query, setQuery] = useState<string | null>(null);
const [tracks, setTracks] = useState<Track[]>([]);
```

### 8.4 API hook pattern

Data fetching must use **TanStack Query**. No raw `useEffect` + `fetch`.

```typescript
// ❌ Bad
useEffect(() => {
  fetch('/api/tracks').then(r => r.json()).then(setTracks);
}, []);

// ✅ Good
import { useQuery } from '@tanstack/react-query';
import { tracksApi } from '@/lib/api';

export function useTracks(params: ListTracksQuery) {
  return useQuery({
    queryKey: ['tracks', params],
    queryFn:  () => tracksApi.list(params),
    staleTime: 5 * 60 * 1000,
  });
}
```

### 8.5 Mutations

```typescript
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';

export function useExecuteQuery(sessionId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sql: string) => queryApi.execute({ sessionId, sql }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['queryHistory', sessionId] });
      toast.success(`Query executed in ${result.durationMs}ms`);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });
}
```

### 8.6 `"use client"` boundary

Add `"use client"` only when the component uses:
- `useState`, `useEffect`, `useRef`, `useCallback`
- Browser APIs (`window`, `document`, `localStorage`)
- Event handlers attached to DOM nodes
- Third-party client-only libraries (CodeMirror, etc.)

Do **not** add `"use client"` to layout files, page containers, or data-display components that receive props.

### 8.7 Design system — banned patterns

```tsx
// ❌ 1px borders to separate sections
<div className="border border-gray-700" />

// ✅ Background color shift instead
<div className="bg-surface-container-low" />  // vs parent bg-surface


// ❌ Pure white text
<p className="text-white">...</p>

// ✅ Design token
<p className="text-on-surface">...</p>


// ❌ Overly rounded corners
<div className="rounded-2xl" />

// ✅ Max is rounded-full (0.75rem)
<div className="rounded-full" />


// ❌ Hardcoded colors
<button style={{ background: '#bac3ff' }}>

// ✅ Tailwind token
<button className="bg-primary text-on-primary-fixed" />
```

---

## 9. Database & ORM

### 9.1 Schema is the type source

Never define a TypeScript interface that duplicates a Drizzle table shape. Infer it:

```typescript
// ❌ Bad — duplicate definition
interface User {
  id: string;
  email: string;
  // ...
}

// ✅ Good — inferred from Drizzle
import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { users } from '../schema';

export type UserRow    = InferSelectModel<typeof users>;
export type InsertUser = InferInsertModel<typeof users>;
```

### 9.2 Repository returns raw rows or null

Repositories never throw. They return `row | null` or `row[]`.

```typescript
// ✅
async findById(id: string): Promise<UserRow | null> {
  const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}
```

### 9.3 Migrations

- **Never** mutate a migration file after it has been committed.
- Generated with `make db:generate`, applied with `make migrate`.
- Migration file names: `0001_create_users.sql` (Drizzle auto-names, do not rename).

### 9.4 Transactions

Use Drizzle transactions for operations that must be atomic:

```typescript
await db.transaction(async (tx) => {
  const [session] = await tx.insert(learningSessions).values({ ... }).returning();
  await tx.insert(sandboxInstances).values({ learningSessionId: session.id, ... });
});
```

---

## 10. Naming Conventions

### General

| Thing | Convention | Example |
|-------|-----------|---------|
| Files | kebab-case | `tracks.service.ts` |
| Classes | PascalCase | `TracksService` |
| Functions & methods | camelCase | `getTrackById` |
| Variables | camelCase | `trackId` |
| Constants (module-level) | SCREAMING_SNAKE | `ACCESS_TOKEN_TTL` |
| Enums | PascalCase key, const object value | `ApiCode.NOT_FOUND` |
| Types / Interfaces | PascalCase | `TrackWithLessonCount` |
| Zod schemas | PascalCase + `Schema` suffix | `ListTracksQuerySchema` |
| Inferred types from Zod | PascalCase (no suffix) | `ListTracksQuery` |

### Backend-specific

| Thing | Convention | Example |
|-------|-----------|---------|
| Route files | `[module].router.ts` | `tracks.router.ts` |
| Handler files | `[module].handler.ts` | `tracks.handler.ts` |
| Service files | `[module].service.ts` | `tracks.service.ts` |
| Repository files | `[module].repository.ts` | `tracks.repository.ts` |
| Zod file | `[module].schema.ts` | `tracks.schema.ts` |
| Local types | `[module].types.ts` | `tracks.types.ts` |

### Frontend-specific

| Thing | Convention | Example |
|-------|-----------|---------|
| Components | PascalCase filename | `TrackCard.tsx` |
| Pages (Next.js) | `page.tsx` in folder | `app/(app)/tracks/page.tsx` |
| Hooks | `use` prefix | `useTrackQuery.ts` |
| Stores | `use` prefix | `useAuthStore` |
| API modules | camelCase + `Api` suffix | `tracksApi` |

### Database-specific

| Thing | Convention | Example |
|-------|-----------|---------|
| Table names | snake_case, plural | `learning_sessions` |
| Column names | snake_case | `created_at`, `lesson_version_id` |
| Drizzle schema vars | camelCase, singular | `schema.learningSession` |
| Index names | `[table]_[cols]_idx` | `sessions_user_status_idx` |
| Enum types | `[name]_enum` | `content_status_enum` |

---

## 11. File Organization

### Imports order (enforced by ESLint)

```typescript
// 1. Node built-ins
import crypto from 'crypto';
import path from 'path';

// 2. External packages
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

// 3. Monorepo packages
import type { Track } from '@sqlcraft/types';
import { ApiCode } from '@sqlcraft/types';

// 4. Internal absolute paths (app-level)
import { getDb, schema } from '../../db';
import { NotFoundError } from '../../lib/errors';
import { success, MESSAGES } from '../../lib/response';

// 5. Relative imports
import type { GetTrackParams } from './tracks.schema';
import { TracksService } from './tracks.service';
```

### Do not barrel-export everything

`index.ts` barrel files are fine for `packages/types`. In `apps/`, prefer direct imports to avoid circular dependencies:

```typescript
// ❌ Bad — opaque barrel
import { TracksService, TracksRepository, TrackWithLessonCount } from '../tracks';

// ✅ Good — explicit
import { TracksService } from '../modules/tracks/tracks.service';
import type { TrackWithLessonCount } from '../modules/tracks/tracks.types';
```

### One class / one exported function per file

Service, repository, and handler files export one class or a small set of closely-related functions. Split if a file exceeds ~200 lines of logic.

---

## Quick Reference — Common Violations

| Violation | Correct Pattern |
|-----------|----------------|
| `async (request, reply)` — no generics | `async (request: FastifyRequest<{Params: T}>, reply: FastifyReply)` |
| DB query inside route handler | Move to repository, call from service |
| Business logic in route handler | Move to service |
| `request.params as { id: string }` cast | Use Fastify generic `<{ Params: MyParamType }>` |
| `throw new Error('...')` in service | `throw new NotFoundError(...)` or other `AppError` subclass |
| Hardcoded error string `'1001'` | `ApiCode.UNAUTHORIZED` |
| `const x: any` | `const x: SpecificType` or `unknown` |
| `React.FC<Props>` component | `function MyComponent(props: Props)` |
| `useState(null)` — untyped | `useState<string | null>(null)` |
| Raw `fetch` in `useEffect` | `useQuery` / `useMutation` from TanStack Query |
| `text-white` in Tailwind | `text-on-surface` |
| `border border-gray-700` dividers | Background color shift |
