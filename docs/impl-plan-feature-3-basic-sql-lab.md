# Implementation Plan: Feature #3 — Basic SQL Lab

## Overview

Feature #3 has a fairly complete UI skeleton but **does not work** because of three core issues:
1. Frontend calls the wrong API endpoints (non-existent routes)
2. Frontend treats results as synchronous while the backend runs async via a job queue
3. Schema panel uses hardcoded mock data instead of fetching from the sandbox

This plan splits into two phases:
- **Phase 1** (Critical): Make the feature work end-to-end
- **Phase 2** (Completion): Polish UX to spec

---

## Phase 1 — Make It Work (Critical Path)

### Task 1.1 — Fix API endpoint mapping (Frontend)

**File:** `apps/web/src/lib/api.ts`

**Issues:**
- `queryApi.execute()` calls `POST /query/execute` → does not exist; should be `POST /v1/query-executions`
- `queryApi.explain()` calls `POST /query/explain` → does not exist; use the same endpoint with `explainPlan: true`
- Body field `sessionId` → backend expects `learningSessionId`

**Changes:**

```ts
// apps/web/src/lib/api.ts

export interface QueryExecutionRequest {
  sessionId: string;       // keep name to avoid breaking store/hooks
  sql: string;
  datasetSize?: 'tiny' | 'small' | 'medium' | 'large';
}

export const queryApi = {
  execute: (payload: QueryExecutionRequest) =>
    api.post<QueryExecution>('/query-executions', {
      learningSessionId: payload.sessionId,  // map field name
      sql: payload.sql,
    }).then((r) => r.data),

  explain: (payload: QueryExecutionRequest) =>
    api.post<QueryExecution>('/query-executions', {
      learningSessionId: payload.sessionId,
      sql: payload.sql,
      explainPlan: true,
      planMode: 'explain_analyze',
    }).then((r) => r.data),

  poll: (executionId: string) =>
    api.get<QueryExecution>(`/query-executions/${executionId}`).then((r) => r.data),

  history: async (sessionId?: string, params?: { page?: number; limit?: number }) => {
    // ... keep existing logic
  },
};
```

**Acceptance criteria:**
- `POST /v1/query-executions` returns `{ id, status: 'accepted', sqlText, submittedAt }`
- No 404 when clicking Run

---

### Task 1.2 — Implement async polling loop (Frontend)

**Files:** `apps/web/src/hooks/use-query-execution.ts`, `apps/web/src/stores/lab.ts`

**Issue:**
Backend returns `{ status: 'accepted' }` immediately and the worker runs the query later. The frontend currently treats the `execute` response as final, so `data.result` stays `null`.

**Fix:** After a successful submit, poll `GET /v1/query-executions/:id` every 500ms until `status` is `succeeded`, `failed`, `timed_out`, or `blocked`.

**Changes in `use-query-execution.ts`:**

```ts
const TERMINAL_STATUSES = new Set(['success', 'error']);
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 35_000; // > backend timeout 30s

export function useExecuteQuery() {
  const queryClient = useQueryClient();
  const setActiveTab = useLabStore((s) => s.setActiveTab);

  return useMutation<QueryExecution, Error, QueryExecutionRequest>({
    mutationFn: async (payload) => {
      // 1. Submit — get accepted execution with id
      const accepted = await queryApi.execute(payload);

      // 2. Poll until terminal
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      let execution = accepted;

      while (!TERMINAL_STATUSES.has(execution.status)) {
        if (Date.now() > deadline) {
          throw new Error('Query timed out waiting for result');
        }
        await sleep(POLL_INTERVAL_MS);
        execution = await queryApi.poll(execution.id);
      }

      return execution;
    },
    onMutate: () => {
      useLabStore.setState({ isExecuting: true, error: null, results: null });
    },
    onSuccess: (data) => {
      // ... keep existing logic
    },
    onError: (err) => {
      // ... keep existing
    },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

**Note:** `useExplainQuery` uses the same polling pattern; only the `executionPlan` field differs.

**Acceptance criteria:**
- Run → spinner → results in table after ~1–3s
- Explain → spinner → Plan tab shows execution plan
- Failed query → correct error message

---

### Task 1.3 — Backend: session schema endpoint

**Files:**
- `apps/api/src/modules/sessions/sessions.router.ts` (add route)
- `apps/api/src/modules/sessions/sessions.handler.ts` (add handler)
- `apps/api/src/modules/sessions/sessions.service.ts` (add service)

**New endpoint:** `GET /v1/learning-sessions/:sessionId/schema`

**Logic:**
1. Load session → `lessonVersionId`
2. Load `lessonVersion` → `schemaTemplateId`
3. Load `schemaTemplate.definition` (JSONB) → parse to table/column list
4. Return normalized schema (reuse `parseSchemaDefinition` + `normalizeColumn` from `databases.service.ts`)

**Response type:**

```ts
interface SessionSchemaResponse {
  schemaTemplateId: string;
  tables: Array<{
    name: string;
    columns: Array<{
      name: string;
      type: string;
      isPrimary: boolean;
      isForeign: boolean;
      isNullable: boolean;
      references?: string;  // "other_table.id"
    }>;
  }>;
}
```

**Note:** This schema comes from `schemaTemplates` in the DB (canonical definition), not live introspection. Enough for Feature #3; Feature #8 needs live introspection.

**Acceptance criteria:**
- `GET /v1/learning-sessions/:id/schema` returns tables + columns for the session database
- 401 if unauthenticated, 403 if not owner, 404 if session missing

---

### Task 1.4 — Frontend: Schema Panel real fetch

**File:** `apps/web/src/app/(app)/lab/[sessionId]/page.tsx`

**Issue:** `SchemaPanel` uses hardcoded `MOCK_SCHEMA`.

**Changes:**
1. Add `sessionsApi.getSchema(sessionId)` in `api.ts`
2. Add `useSessionSchema(sessionId)` in `use-query-execution.ts`
3. `SchemaPanel` takes `sessionId`, uses hook, shows loading/error

**Add to `api.ts`:**

```ts
export const sessionsApi = {
  // ... existing methods
  getSchema: (id: string) =>
    api.get<SessionSchemaResponse>(`/learning-sessions/${id}/schema`).then((r) => r.data),
};
```

**SchemaPanel update:**

```tsx
function SchemaPanel({ sessionId }: { sessionId: string }) {
  const { data: schema, isLoading, isError } = useSessionSchema(sessionId);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);

  if (isLoading) return <SchemaSkeleton />;
  if (isError || !schema) return <SchemaError />;

  // same UI as before but with real schema.tables
}
```

**Acceptance criteria:**
- Schema panel shows tables/columns for the session database
- PK (key icon), FK (link icon)
- Loading skeleton while fetching
- Error state on failure

---

## Phase 2 — Complete the Spec (UX Polish)

### Task 2.1 — Session lifecycle management

**File:** `apps/web/src/app/(app)/lab/[sessionId]/page.tsx`

**Issue:** When session is `expired` or `failed`, there is no CTA; users get stuck.

**Change:** Add `LabSessionExpired` when `session?.status` is `expired`, `failed`, or `ended`:

```tsx
function LabSessionExpired({ onNewSession }: { onNewSession: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-4">
        <span className="material-symbols-outlined text-5xl text-outline">timer_off</span>
        <h2 className="text-lg font-semibold">Lab session has ended</h2>
        <p className="text-sm text-on-surface-variant max-w-sm">
          This session expired or was stopped. Start a new one from Explore.
        </p>
        <div className="flex gap-2 justify-center">
          <Link href="/explore"><Button variant="primary">Choose another database</Button></Link>
          <Link href="/lab"><Button variant="secondary">Back to SQL Lab</Button></Link>
        </div>
      </div>
    </div>
  );
}
```

Replace tab content when session is not active/provisioning.

**Acceptance criteria:**
- `expired`/`failed`/`ended` → expired screen with link to `/explore`
- `provisioning` → spinner + “Starting sandbox...” in result pane
- Run/Explain disabled with tooltip until session ready

---

### Task 2.2 — Result table: truncation indicator & row count

**File:** `apps/web/src/app/(app)/lab/[sessionId]/page.tsx` — `ResultsPanel`

**Below result table when `results.truncated === true`:**

```tsx
{results.truncated && (
  <div className="shrink-0 flex items-center gap-2 border-t border-outline-variant/10 bg-surface-container-low px-4 py-2">
    <span className="material-symbols-outlined text-sm text-tertiary">info</span>
    <span className="text-xs text-on-surface-variant">
      Showing <span className="font-mono text-on-surface">{results.rows.length}</span> of{' '}
      <span className="font-mono text-on-surface">{results.totalRows.toLocaleString()}</span> rows.
      Results are limited to the first 500 rows.
    </span>
  </div>
)}
```

**Acceptance criteria:**
- Truncated results → clear X/Y banner
- No banner when not truncated
- Status bar still shows duration + row count

---

### Task 2.3 — Copy to clipboard

**File:** `apps/web/src/app/(app)/lab/[sessionId]/page.tsx`

**Two places:**

1. **Copy Query** — icon in editor tab bar (next to “X lines”):
```tsx
<button onClick={() => copyToClipboard(currentQuery)} title="Copy query">
  <span className="material-symbols-outlined text-base text-outline hover:text-on-surface">content_copy</span>
</button>
```

2. **Copy Results as CSV** — icon in results tab bar (when `activeTab === 'results' && results`):
```tsx
<button onClick={() => copyResultsAsCsv(results)} title="Copy results as CSV">
  <span className="material-symbols-outlined text-base text-outline hover:text-on-surface">content_copy</span>
</button>
```

**Helper:**
```ts
function copyResultsAsCsv(results: QueryResultPreview) {
  const header = results.columns.map((c) => c.name).join(',');
  const rows = results.rows.map((row) =>
    results.columns.map((c) => JSON.stringify(row[c.name] ?? '')).join(',')
  );
  navigator.clipboard.writeText([header, ...rows].join('\n'));
  toast.success('Results copied');
}
```

**Acceptance criteria:**
- Copy query → current SQL in clipboard
- Copy results → CSV (header + rows)
- Toast after each copy

---

### Task 2.4 — Clear editor button

**File:** `apps/web/src/app/(app)/lab/[sessionId]/page.tsx` — header toolbar

**Next to Format:**

```tsx
<Button
  variant="ghost"
  size="sm"
  disabled={!currentQuery.trim()}
  onClick={() => {
    setQuery('');
    useLabStore.getState().resetResults();
  }}
  title="Clear editor and results"
  leftIcon={<span className="material-symbols-outlined text-[18px]">delete_sweep</span>}
>
  Clear
</Button>
```

**Acceptance criteria:**
- Clear → empty editor, cleared results/error/plan
- Disabled when editor empty
- No confirm (reversible via Ctrl+Z)

---

## Execution order

```
Task 1.1 → Task 1.2 → [Task 1.3 in parallel with Task 1.4*] → Task 2.x
```

*Task 1.4 depends on Task 1.3 (backend endpoint first).

**Priority by impact:**

| Task | Effort | Impact | Order |
|------|--------|--------|-------|
| 1.1 Fix API endpoint | XS (~30 min) | Critical | 1st |
| 1.2 Async polling | S (~2 h) | Critical | 2nd |
| 1.3 Backend schema endpoint | S (~2 h) | High | 3rd |
| 1.4 Schema Panel real fetch | S (~1 h) | High | 4th |
| 2.1 Session lifecycle | S (~1.5 h) | Medium | 5th |
| 2.2 Truncation indicator | XS (~30 min) | Medium | 6th |
| 2.3 Copy to clipboard | XS (~45 min) | Medium | 7th |
| 2.4 Clear editor | XS (~15 min) | Low | 8th |

**Rough total: ~10 hours**

---

## Definition of Done

Feature #3 is done when:

- [ ] Run → results in table (not blank/null)
- [ ] Explain → execution plan JSON visible
- [ ] SQL error → correct message type (validation vs runtime)
- [ ] Schema tab → real tables/columns for session DB
- [ ] Session expired/failed → CTA to start a new session
- [ ] Truncated results → clear banner
- [ ] Copy query and copy results work
- [ ] Clear button works
- [ ] No mock data left in code

---

## Out of scope for Feature #3

Handled by other features, **not** in this plan:

- Schema-aware SQL autocompletion → depends on Feature #3 schema API but is a separate enhancement
- Execution plan tree visualizer → Feature #6
- Side-by-side query comparison → Feature #8
- Schema diff (indexes/partitions/procedures in sandbox) → Feature #8
- Challenge submission → Feature #4
- Lesson content panel → Feature #2
