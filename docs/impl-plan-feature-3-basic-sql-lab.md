# Implementation Plan: Feature #3 — Basic SQL Lab

## Tổng quan

Feature #3 hiện có UI skeleton khá hoàn chỉnh nhưng **không hoạt động** do 3 vấn đề cốt lõi:
1. Frontend gọi sai API endpoint (endpoint không tồn tại)
2. Frontend xử lý kết quả như sync trong khi backend thực thi async qua job queue
3. Schema panel dùng mock data cứng thay vì fetch thật từ sandbox

Plan này chia thành 2 phase:
- **Phase 1** (Critical): Làm cho feature hoạt động được end-to-end
- **Phase 2** (Completion): Hoàn thiện UX theo spec

---

## Phase 1 — Make It Work (Critical Path)

### Task 1.1 — Fix API endpoint mapping (Frontend)

**File:** `apps/web/src/lib/api.ts`

**Vấn đề:**
- `queryApi.execute()` gọi `POST /query/execute` → không tồn tại, phải là `POST /v1/query-executions`
- `queryApi.explain()` gọi `POST /query/explain` → không tồn tại, phải dùng cùng endpoint với `explainPlan: true`
- Body field `sessionId` → backend expect `learningSessionId`

**Thay đổi:**

```ts
// apps/web/src/lib/api.ts

export interface QueryExecutionRequest {
  sessionId: string;       // giữ nguyên để không break store/hooks
  sql: string;
  datasetSize?: 'tiny' | 'small' | 'medium' | 'large';
}

export const queryApi = {
  execute: (payload: QueryExecutionRequest) =>
    api.post<QueryExecution>('/query-executions', {
      learningSessionId: payload.sessionId,  // map lại tên field
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
    // ... giữ nguyên logic hiện tại
  },
};
```

**Acceptance criteria:**
- `POST /v1/query-executions` trả về `{ id, status: 'accepted', sqlText, submittedAt }`
- Không còn 404 khi bấm Run

---

### Task 1.2 — Implement async polling loop (Frontend)

**Files:** `apps/web/src/hooks/use-query-execution.ts`, `apps/web/src/stores/lab.ts`

**Vấn đề:**
Backend trả về ngay `{ status: 'accepted' }` rồi worker mới chạy query. Frontend hiện tại xử lý response của `execute` như thể đó là kết quả cuối cùng, nên `data.result` luôn `null`.

**Giải pháp:** Sau khi submit thành công, poll `GET /v1/query-executions/:id` mỗi 500ms cho đến khi `status` là `succeeded`, `failed`, `timed_out`, hoặc `blocked`.

**Thay đổi trong `use-query-execution.ts`:**

```ts
const TERMINAL_STATUSES = new Set(['success', 'error']);
const POLL_INTERVAL_MS = 500;
const POLL_TIMEOUT_MS = 35_000; // > backend timeout 30s

export function useExecuteQuery() {
  const queryClient = useQueryClient();
  const setActiveTab = useLabStore((s) => s.setActiveTab);

  return useMutation<QueryExecution, Error, QueryExecutionRequest>({
    mutationFn: async (payload) => {
      // 1. Submit — nhận về accepted execution với id
      const accepted = await queryApi.execute(payload);

      // 2. Poll cho đến khi có kết quả
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
      // ... giữ nguyên logic hiện tại
    },
    onError: (err) => {
      // ... giữ nguyên
    },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

**Lưu ý:** `useExplainQuery` áp dụng cùng pattern polling, chỉ khác ở field `executionPlan` được lấy từ kết quả.

**Acceptance criteria:**
- Bấm Run → spinner → kết quả hiển thị trong bảng sau ~1-3 giây
- Bấm Explain → spinner → tab Plan hiển thị execution plan
- Nếu query lỗi → error message hiển thị đúng

---

### Task 1.3 — Backend: thêm endpoint lấy schema của session

**Files:**
- `apps/api/src/modules/sessions/sessions.router.ts` (thêm route)
- `apps/api/src/modules/sessions/sessions.handler.ts` (thêm handler)
- `apps/api/src/modules/sessions/sessions.service.ts` (thêm service function)

**Endpoint mới:** `GET /v1/learning-sessions/:sessionId/schema`

**Logic:**
1. Lấy session → lấy `lessonVersionId`
2. Lấy `lessonVersion` → lấy `schemaTemplateId`
3. Lấy `schemaTemplate.definition` (JSONB) → parse thành danh sách bảng/cột
4. Return schema đã normalize (dùng lại logic `parseSchemaDefinition` + `normalizeColumn` đã có trong `databases.service.ts`)

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

**Lưu ý:** Schema này lấy từ `schemaTemplates` trong DB (định nghĩa gốc), không phải introspect live sandbox. Đây là đủ cho Feature #3. Feature #8 mới cần introspect live.

**Acceptance criteria:**
- `GET /v1/learning-sessions/:id/schema` trả về danh sách bảng + cột đúng với database đang dùng trong session
- 401 nếu không authed, 403 nếu không phải owner, 404 nếu session không tồn tại

---

### Task 1.4 — Frontend: Schema Panel fetch thật

**File:** `apps/web/src/app/(app)/lab/[sessionId]/page.tsx`

**Vấn đề:** `SchemaPanel` dùng `MOCK_SCHEMA` hardcoded.

**Thay đổi:**
1. Thêm `sessionsApi.getSchema(sessionId)` vào `api.ts`
2. Thêm `useSessionSchema(sessionId)` hook trong `use-query-execution.ts`
3. `SchemaPanel` nhận `sessionId` prop, dùng hook để fetch, hiển thị loading/error state

**Thêm vào `api.ts`:**

```ts
export const sessionsApi = {
  // ... existing methods
  getSchema: (id: string) =>
    api.get<SessionSchemaResponse>(`/learning-sessions/${id}/schema`).then((r) => r.data),
};
```

**SchemaPanel cập nhật:**

```tsx
function SchemaPanel({ sessionId }: { sessionId: string }) {
  const { data: schema, isLoading, isError } = useSessionSchema(sessionId);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);

  if (isLoading) return <SchemaSkeleton />;
  if (isError || !schema) return <SchemaError />;

  // render giống UI cũ nhưng dùng schema.tables thật
}
```

**Acceptance criteria:**
- Schema panel hiển thị đúng bảng/cột của database đang dùng trong session
- Hiển thị primary key (icon key), foreign key (icon link)
- Loading skeleton khi fetch
- Error state nếu fetch thất bại

---

## Phase 2 — Complete the Spec (UX Polish)

### Task 2.1 — Session Lifecycle Management

**File:** `apps/web/src/app/(app)/lab/[sessionId]/page.tsx`

**Vấn đề:** Khi session `expired` hoặc `failed`, UI không có CTA nào. Người dùng bị kẹt.

**Thay đổi:** Thêm `LabSessionExpired` component hiển thị khi `session?.status` là `expired`, `failed`, hoặc `ended`:

```tsx
function LabSessionExpired({ onNewSession }: { onNewSession: () => void }) {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="text-center space-y-4">
        <span className="material-symbols-outlined text-5xl text-outline">timer_off</span>
        <h2 className="text-lg font-semibold">Phiên lab đã kết thúc</h2>
        <p className="text-sm text-on-surface-variant max-w-sm">
          Session này đã hết hạn hoặc bị ngắt. Tạo phiên mới từ trang Explore.
        </p>
        <div className="flex gap-2 justify-center">
          <Link href="/explore"><Button variant="primary">Chọn database mới</Button></Link>
          <Link href="/lab"><Button variant="secondary">Về SQL Lab</Button></Link>
        </div>
      </div>
    </div>
  );
}
```

Hiển thị thay thế nội dung tab khi session không còn active/provisioning.

**Acceptance criteria:**
- Session `expired`/`failed`/`ended` → hiển thị màn hình expired với link đến `/explore`
- Session `provisioning` → spinner + text "Đang khởi động sandbox..." trong result pane
- Nút Run/Explain bị disable và có tooltip khi session chưa ready

---

### Task 2.2 — Result Table: Truncation Indicator & Row Count

**File:** `apps/web/src/app/(app)/lab/[sessionId]/page.tsx` — `ResultsPanel`

**Thêm vào dưới result table khi `results.truncated === true`:**

```tsx
{results.truncated && (
  <div className="shrink-0 flex items-center gap-2 border-t border-outline-variant/10 bg-surface-container-low px-4 py-2">
    <span className="material-symbols-outlined text-sm text-tertiary">info</span>
    <span className="text-xs text-on-surface-variant">
      Hiển thị <span className="font-mono text-on-surface">{results.rows.length}</span> trong{' '}
      <span className="font-mono text-on-surface">{results.totalRows.toLocaleString()}</span> dòng.
      Kết quả bị giới hạn ở 500 dòng đầu.
    </span>
  </div>
)}
```

**Acceptance criteria:**
- Khi kết quả bị truncate: banner thông báo hiển thị rõ X/Y rows
- Khi không truncate: không hiển thị banner
- Status bar vẫn hiển thị duration + row count như cũ

---

### Task 2.3 — Copy to Clipboard

**File:** `apps/web/src/app/(app)/lab/[sessionId]/page.tsx`

**Thêm 2 nơi:**

1. **Copy Query** — icon button ở tab bar của editor pane (cạnh "X lines"):
```tsx
<button onClick={() => copyToClipboard(currentQuery)} title="Copy query">
  <span className="material-symbols-outlined text-base text-outline hover:text-on-surface">content_copy</span>
</button>
```

2. **Copy Results as CSV** — icon button ở tab bar của result pane (chỉ hiển thị khi `activeTab === 'results' && results`):
```tsx
<button onClick={() => copyResultsAsCsv(results)} title="Copy results as CSV">
  <span className="material-symbols-outlined text-base text-outline hover:text-on-surface">content_copy</span>
</button>
```

**Helper function:**
```ts
function copyResultsAsCsv(results: QueryResultPreview) {
  const header = results.columns.map((c) => c.name).join(',');
  const rows = results.rows.map((row) =>
    results.columns.map((c) => JSON.stringify(row[c.name] ?? '')).join(',')
  );
  navigator.clipboard.writeText([header, ...rows].join('\n'));
  toast.success('Đã copy kết quả');
}
```

**Acceptance criteria:**
- Copy query → clipboard chứa SQL hiện tại
- Copy results → clipboard chứa CSV (header + rows)
- Toast confirm sau mỗi lần copy

---

### Task 2.4 — Clear Editor Button

**File:** `apps/web/src/app/(app)/lab/[sessionId]/page.tsx` — header toolbar

**Thêm vào nhóm button (cạnh Format):**

```tsx
<Button
  variant="ghost"
  size="sm"
  disabled={!currentQuery.trim()}
  onClick={() => {
    setQuery('');
    useLabStore.getState().resetResults();
  }}
  title="Xóa editor và kết quả"
  leftIcon={<span className="material-symbols-outlined text-[18px]">delete_sweep</span>}
>
  Clear
</Button>
```

**Acceptance criteria:**
- Bấm Clear → editor trống, results/error/plan đều cleared
- Button disable khi editor đã trống
- Không cần confirm dialog (action reversible bằng Ctrl+Z)

---

## Thứ tự thực hiện

```
Task 1.1 → Task 1.2 → [Task 1.3 song song Task 1.4*] → Task 2.x
```

*Task 1.4 phụ thuộc Task 1.3 (cần backend endpoint trước).

**Ưu tiên theo impact:**

| Task | Effort | Impact | Thứ tự |
|------|--------|--------|--------|
| 1.1 Fix API endpoint | XS (~30 phút) | Critical | 1st |
| 1.2 Async polling | S (~2 giờ) | Critical | 2nd |
| 1.3 Backend schema endpoint | S (~2 giờ) | High | 3rd |
| 1.4 Schema Panel fetch thật | S (~1 giờ) | High | 4th |
| 2.1 Session lifecycle | S (~1.5 giờ) | Medium | 5th |
| 2.2 Truncation indicator | XS (~30 phút) | Medium | 6th |
| 2.3 Copy to clipboard | XS (~45 phút) | Medium | 7th |
| 2.4 Clear editor | XS (~15 phút) | Low | 8th |

**Tổng ước tính: ~10 giờ**

---

## Definition of Done

Feature #3 hoàn thành khi:

- [ ] Bấm Run → thấy kết quả trong bảng (không phải blank/null)
- [ ] Bấm Explain → thấy execution plan JSON
- [ ] Lỗi SQL → hiển thị error message đúng loại (validation vs runtime)
- [ ] Schema tab → hiển thị bảng/cột thật của database đang dùng
- [ ] Session expired/failed → có CTA để tạo session mới
- [ ] Kết quả truncated → banner rõ ràng
- [ ] Copy query và copy results hoạt động
- [ ] Clear button hoạt động
- [ ] Không còn mock data trong code

---

## Không thuộc scope Feature #3

Những thứ này thuộc các feature khác, **không** implement trong plan này:

- Schema-aware SQL autocompletion → phụ thuộc Feature #3 schema API xong, nhưng là enhancement riêng
- Execution Plan tree visualizer → Feature #6
- Side-by-side query comparison → Feature #8
- Schema diff view (indexes/partitions/procedures thêm vào sandbox) → Feature #8
- Challenge submission → Feature #4
- Lesson content panel → Feature #2
