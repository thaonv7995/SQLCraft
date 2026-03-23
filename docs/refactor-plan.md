# Refactor Plan — Align Codebase to Code Conventions

> **Goal:** Bring `apps/api` and `apps/web` into full compliance with `docs/code-conventions.md`.
> **Branch:** `refactor/convention-alignment`
> **Estimated scope:** ~8 focused PRs, each independently reviewable and mergeable.

---

## Overview of Changes

| Area | Current state | Target state |
|------|--------------|-------------|
| API structure | Flat `routes/*.ts` — all logic mixed | 4-layer `modules/` (router/handler/service/repository) |
| Fastify typing | `async (request, reply)` — bare, uses `as` casts | Typed generics on every route method |
| ApiCode | `export enum ApiCode` | `export const ApiCode = {...} as const` |
| Env validation | `process.env.X` inline everywhere | Zod-validated `config` object from `lib/config.ts` |
| Repositories | None — DB queries live in routes | `db/repositories/*.repository.ts` per feature |
| Return types | Mostly implicit | Explicit on all exported functions |
| Frontend props | Several untyped / implicit | All components have explicit `Props` interface |
| Frontend hooks | Mixed `useEffect`+fetch and TanStack | All data fetching via `useQuery`/`useMutation` |

---

## PR 1 — `refactor: ApiCode enum → const object`

**Why first:** Every other PR imports `ApiCode`. Fixing the type here unblocks everything else.

**Files changed:**
- `packages/types/src/index.ts`

**Change:**
```typescript
// Before
export enum ApiCode {
  SUCCESS = '0000',
  NOT_FOUND = '2002',
  // ...
}

// After
export const ApiCode = {
  SUCCESS:             '0000',
  CREATED:             '0001',
  ACCEPTED:            '0002',
  UNAUTHORIZED:        '1001',
  FORBIDDEN:           '1002',
  TOKEN_EXPIRED:       '1003',
  TOKEN_INVALID:       '1004',
  INVALID_CREDENTIALS: '1005',
  VALIDATION_ERROR:    '2001',
  NOT_FOUND:           '2002',
  ALREADY_EXISTS:      '2003',
  CONFLICT:            '2004',
  SESSION_NOT_READY:          '3001',
  SESSION_EXPIRED:            '3002',
  SESSION_NOT_FOUND:          '3003',
  SANDBOX_NOT_READY:          '3004',
  SANDBOX_PROVISIONING_FAILED:'3005',
  SANDBOX_BUSY:               '3006',
  QUERY_BLOCKED:              '4001',
  QUERY_TIMEOUT:              '4002',
  QUERY_EXECUTION_FAILED:     '4003',
  QUERY_SYNTAX_ERROR:         '4004',
  QUERY_RESULT_TOO_LARGE:     '4005',
  CONTENT_NOT_PUBLISHED:      '5001',
  CONTENT_VERSION_NOT_FOUND:  '5002',
  RATE_LIMITED:               '6001',
  INTERNAL_ERROR:             '9001',
  SERVICE_UNAVAILABLE:        '9002',
} as const;

export type ApiCode = typeof ApiCode[keyof typeof ApiCode];
```

**Verify:** `pnpm typecheck` passes across all packages.

---

## PR 2 — `feat: env validation via config.ts`

**Why:** Currently every file does `process.env.DATABASE_URL` — no validation, no type safety, silent failures in production.

**Files to create:**
- `apps/api/src/lib/config.ts`
- `services/worker/src/lib/config.ts`

**`apps/api/src/lib/config.ts`:**
```typescript
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV:            z.enum(['development', 'test', 'production']).default('development'),
  API_PORT:            z.coerce.number().default(4000),
  DATABASE_URL:        z.string().url('DATABASE_URL must be a valid URL'),
  REDIS_URL:           z.string().url('REDIS_URL must be a valid URL'),
  JWT_SECRET:          z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN:      z.string().default('15m'),
  STORAGE_ENDPOINT:    z.string().url(),
  STORAGE_ACCESS_KEY:  z.string().min(1),
  STORAGE_SECRET_KEY:  z.string().min(1),
  STORAGE_BUCKET:      z.string().default('sqlcraft'),
  SANDBOX_DB_HOST:     z.string(),
  SANDBOX_DB_PORT:     z.coerce.number().default(5432),
  SANDBOX_DB_USER:     z.string(),
  SANDBOX_DB_PASSWORD: z.string(),
  SANDBOX_MAX_QUERY_TIME_MS: z.coerce.number().default(30000),
  SANDBOX_MAX_ROWS_PREVIEW:  z.coerce.number().default(500),
  RATE_LIMIT_WINDOW_MS:      z.coerce.number().default(60000),
  RATE_LIMIT_MAX_REQUESTS:   z.coerce.number().default(100),
});

const result = EnvSchema.safeParse(process.env);
if (!result.success) {
  console.error('❌ Invalid environment variables:');
  console.error(result.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = result.data;
export type Config = typeof config;
```

**Files to update:**
- `apps/api/src/index.ts` — replace all `process.env.X` with `config.X`
- `apps/api/src/db/index.ts` — `config.DATABASE_URL`
- `apps/api/src/routes/*.ts` — wherever env vars are accessed directly

---

## PR 3 — `refactor: extract repositories layer`

**Why:** Routes currently contain Drizzle queries. Repositories own all DB access.

**Files to create** (`apps/api/src/db/repositories/`):

| File | Extracts from |
|------|--------------|
| `users.repository.ts` | `routes/auth.ts`, `routes/users.ts`, `routes/admin/index.ts` |
| `tracks.repository.ts` | `routes/tracks.ts`, `routes/admin/index.ts` |
| `lessons.repository.ts` | `routes/lessons.ts`, `routes/admin/index.ts` |
| `sessions.repository.ts` | `routes/sessions.ts` |
| `queries.repository.ts` | `routes/queries.ts` |
| `challenges.repository.ts` | `routes/challenges.ts` |
| `sandboxes.repository.ts` | `routes/sandboxes.ts`, `routes/sessions.ts` |

**Repository contract:**
```typescript
// ✅ Returns row | null — never throws
async findById(id: string): Promise<UserRow | null>

// ✅ Returns array — never throws, empty array if none
async findByUserId(userId: string): Promise<SessionRow[]>

// ✅ Returns inserted/updated row
async create(data: InsertUser): Promise<UserRow>
async update(id: string, data: Partial<InsertUser>): Promise<UserRow | null>
```

**Infer types from Drizzle schema — never duplicate:**
```typescript
import { InferSelectModel, InferInsertModel } from 'drizzle-orm';
import { schema } from '../index';

export type UserRow    = InferSelectModel<typeof schema.users>;
export type InsertUser = InferInsertModel<typeof schema.users>;
```

---

## PR 4 — `refactor: migrate routes/ to modules/ (auth + users)`

**Why small scope:** Start with auth — it's self-contained and touches the most cross-cutting concerns (JWT, token handling). Proves the pattern before scaling.

**Directory structure to create:**
```
apps/api/src/modules/auth/
├── auth.router.ts     ← replaces routes/auth.ts (registration only)
├── auth.handler.ts    ← NEW: request parsing + reply building
├── auth.service.ts    ← NEW: business logic extracted from old route
├── auth.schema.ts     ← NEW: Zod schemas + inferred types
└── auth.types.ts      ← NEW: AuthTokens, JwtPayload (moved from plugins/auth.ts)

apps/api/src/modules/users/
├── users.router.ts
├── users.handler.ts
├── users.service.ts
├── users.schema.ts
└── users.types.ts
```

**Typing fix example (handler.ts):**
```typescript
// auth.router.ts
fastify.post<{ Body: RegisterBody }>(
  '/v1/auth/register',
  { schema: { ... } },
  registerHandler,   // ← delegate, don't inline
);

// auth.handler.ts
export async function registerHandler(
  request: FastifyRequest<{ Body: RegisterBody }>,
  reply: FastifyReply,
): Promise<void> {
  const body = RegisterBodySchema.parse(request.body);
  const result = await authService.register(body);
  return reply.status(201).send(created(result, MESSAGES.REGISTER_SUCCESS));
}

// auth.service.ts
async register(dto: RegisterBody): Promise<{ user: UserPublic; tokens: AuthTokens }> {
  const existing = await usersRepo.findByEmail(dto.email);
  if (existing) throw new ConflictError('Email already registered');
  // ...
}
```

**Files to delete after migration:**
- `apps/api/src/routes/auth.ts`
- `apps/api/src/routes/users.ts`

**Update `apps/api/src/index.ts`:**
```typescript
// Before
fastify.register(import('./routes/auth'));

// After
fastify.register(import('./modules/auth/auth.router'));
```

---

## PR 5 — `refactor: migrate tracks + lessons + challenges modules`

Same pattern as PR 4.

**Directory structure:**
```
apps/api/src/modules/
├── tracks/
│   ├── tracks.router.ts
│   ├── tracks.handler.ts
│   ├── tracks.service.ts
│   ├── tracks.schema.ts
│   └── tracks.types.ts       ← TrackWithLessonCount
├── lessons/
│   ├── lessons.router.ts
│   ├── lessons.handler.ts
│   ├── lessons.service.ts
│   ├── lessons.schema.ts
│   └── lessons.types.ts      ← LessonVersionWithChallenges
└── challenges/
    ├── challenges.router.ts
    ├── challenges.handler.ts
    ├── challenges.service.ts
    ├── challenges.schema.ts
    └── challenges.types.ts
```

**Key typing fixes in this PR:**
```typescript
// Before (routes/tracks.ts line 124)
const { trackId } = request.params as { trackId: string };

// After (tracks.router.ts)
fastify.get<{ Params: GetTrackParams }>('/v1/tracks/:trackId', ..., getTrackHandler);

// After (tracks.handler.ts)
export async function getTrackHandler(
  request: FastifyRequest<{ Params: GetTrackParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { trackId } = request.params; // no cast needed
```

**Delete:** `routes/tracks.ts`, `routes/lessons.ts`, `routes/challenges.ts`

---

## PR 6 — `refactor: migrate sessions + queries + sandboxes modules`

These three are grouped because they're tightly coupled (session → sandbox → query).

```
apps/api/src/modules/
├── sessions/
│   ├── sessions.router.ts
│   ├── sessions.handler.ts
│   ├── sessions.service.ts    ← session + sandbox creation, BullMQ enqueue
│   ├── sessions.schema.ts
│   └── sessions.types.ts
├── queries/
│   ├── queries.router.ts
│   ├── queries.handler.ts
│   ├── queries.service.ts     ← delegates to query-executor service
│   ├── queries.schema.ts
│   └── queries.types.ts
└── sandboxes/
    ├── sandboxes.router.ts
    ├── sandboxes.handler.ts
    ├── sandboxes.service.ts
    ├── sandboxes.schema.ts
    └── sandboxes.types.ts
```

**Move `services/query-executor.ts` → `modules/queries/query-executor.service.ts`** — it's a service, not a standalone util.

**Key typing fix:**
```typescript
// routes/sessions.ts (current — bad)
async (request, reply) => {
  const { sessionId } = request.params as { sessionId: string };
  const userId = request.user!.sub;  // ! non-null assertion

// sessions.handler.ts (target — good)
export async function getSessionHandler(
  request: FastifyRequest<{ Params: GetSessionParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { sessionId } = request.params;  // typed, no cast
  const userId = request.user.sub;       // no ! needed after authenticate hook
```

**Delete:** `routes/sessions.ts`, `routes/queries.ts`, `routes/sandboxes.ts`

---

## PR 7 — `refactor: migrate admin module`

```
apps/api/src/modules/admin/
├── admin.router.ts
├── admin.handler.ts
├── admin.service.ts
├── admin.schema.ts
└── admin.types.ts
```

**Delete:** `routes/admin/index.ts` (and the `routes/admin/` directory)

---

## PR 8 — `refactor: frontend — prop types + hook patterns`

**Scope:** `apps/web/src`

### 8.1 Add explicit prop types to all components

**Files to update:**

```
components/ui/button.tsx
components/ui/badge.tsx
components/ui/card.tsx
components/ui/input.tsx
components/ui/table.tsx
components/layout/navbar.tsx
components/layout/sidebar.tsx
```

**Pattern:**
```typescript
// Before
export function Button({ children, variant, size, onClick, disabled, isLoading }) {

// After
interface ButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  size?: 'sm' | 'md' | 'lg';
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  isLoading?: boolean;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  ...
}: ButtonProps): React.ReactElement {
```

### 8.2 Type all `useState` calls

Search pattern: `useState(null)`, `useState([])`, `useState('')` without generics.

```typescript
// Before
const [tracks, setTracks] = useState([]);
const [error, setError] = useState(null);

// After
const [tracks, setTracks] = useState<Track[]>([]);
const [error, setError] = useState<string | null>(null);
```

### 8.3 Fix event handler types

```typescript
// Before
const handleSearch = (e) => setSearch(e.target.value);

// After
const handleSearch = (e: React.ChangeEvent<HTMLInputElement>): void => {
  setSearch(e.target.value);
};
```

### 8.4 Migrate raw fetch → TanStack Query

Files with raw `fetch` or `axios` calls directly in `useEffect`:

```typescript
// Before
useEffect(() => {
  axios.get('/api/tracks').then(r => setTracks(r.data));
}, []);

// After
const { data: tracks, isLoading } = useQuery({
  queryKey: ['tracks'],
  queryFn:  () => tracksApi.list({ page: 1, limit: 20 }),
});
```

---

## Execution Order

```
PR 1  →  PR 2  →  PR 3  →  PR 4  →  PR 5  →  PR 6  →  PR 7  →  PR 8
 │        │        │        │          │          │          │       │
types   config  repos   auth+users  content  runtime   admin  frontend
```

PRs 4–7 can be split across team members after PR 3 lands (each module is independent). PR 8 is frontend-only and can run in parallel with PRs 4–7.

---

## Definition of Done per PR

- [ ] `pnpm typecheck` passes — zero type errors
- [ ] `pnpm lint` passes — zero lint errors
- [ ] No `any` types added
- [ ] No `as SomeType` casts without a comment explaining why
- [ ] No business logic in routers
- [ ] No DB queries outside repositories
- [ ] All exported functions have explicit return types
- [ ] Deleted files are fully replaced (no dead `import` references)
- [ ] Swagger docs still render correctly at `GET /docs`

---

## Files to Delete After All PRs

```
apps/api/src/routes/auth.ts
apps/api/src/routes/users.ts
apps/api/src/routes/tracks.ts
apps/api/src/routes/lessons.ts
apps/api/src/routes/challenges.ts
apps/api/src/routes/sessions.ts
apps/api/src/routes/queries.ts
apps/api/src/routes/sandboxes.ts
apps/api/src/routes/admin/index.ts
apps/api/src/routes/          ← entire directory removed
apps/api/src/services/query-executor.ts  ← moved to modules/queries/
```
