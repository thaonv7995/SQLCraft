# Refactor plan — Dataset scale-down

> **Scope:** Per-table row allocation (`scaleDatasetRowCounts` in `apps/api/src/lib/dataset-scales.ts`), aligning **requested vs actual** with the SQL materialization pipeline (`materializeDerivedSqlDumpArtifacts` / `selectRowsForTargets` in `apps/api/src/modules/admin/real-dataset-artifact.ts`), and reducing **FK / schema metadata** risk.

---

## Background

- **`DATASET_SCALE_TARGET_TOTAL_ROWS`** defines the **target total row count** per tier; `buildDerivedDatasetRowCounts` calls `scaleDatasetRowCounts` to produce **requested** per-table row counts.
- **Current `scaleDatasetRowCounts`:** proportional × `target`, `floor`, at least one row per table (when source count > 0), then heuristic loops to hit `target` — proportions skew when many small tables exist.
- **Derived materialization:** real rows are chosen using **topological order + `rowSatisfiesForeignKeys`**; the output is **`actualRowCounts`**, which may be **lower** than requested when FKs or available rows do not allow more.
- **Risks:** definition missing inline `references` on columns → no closure; cyclic FKs skipped; composite FKs / `ALTER TABLE` constraints not parsed; UI showing stale targets → mismatched expectations.

---

## 1. Goals and principles

| Goal | How to measure |
|------|----------------|
| Integer allocation **closer to proportions** than current `floor + heuristic` | Compare \(\sum_i \|a_i - r_i\|\) or max deviation vs baseline |
| **Do not break** the existing derived-SQL pipeline with FK closure | Regression tests; every artifact still passes through `selectRowsForTargets` |
| **Requested vs actual** clear in DB/API/UI | Single source of truth for “real” row counts: `actualRowCounts` after closure; `requested` is algorithm input only |
| Fewer orphans when **FKs are missing from definition** | Parser / warnings / optional strict mode |

**Principle:** `scaleDatasetRowCounts` only emits **requested targets**; **relationship enforcement** remains the job of `real-dataset-artifact` plus complete schema. The two layers stay **separate functions**, but the **contract** between them is tightened (logging, types, persistence).

---

## 2. Technical directions (A–D)

| Direction | Idea |
|-----------|------|
| **A. Largest remainder (Hamilton)** | `floor(r_i)`, distribute `target - sum(floors)` to indices with the **largest fractional parts**; deterministic tie-break (e.g. table name). Optional: then apply **min 1** only to “important” tables, or global min-1 plus a short rebalance to `target`. |
| **B. Drop global min-1** | Allow `a_i = 0` when `r_i < 1` if schema/pipeline accepts empty tables; rule: child > 0 while parent = 0 → invalid → clamp or warn (may delegate to `selectRowsForTargets` + warning). |
| **C. Stratification (fact / dimension)** | Table metadata (`role`) or weak heuristics; keep dimensions capped/full small, allocate remaining `target` to **fact** tables via Hamilton within the fact set. |
| **D. Quadratic objective** | Minimize \(\sum w_i (a_i - r_i)^2\) with \(\sum a_i = target\), \(a_i \in \mathbb{Z}_{\geq 0}\) — only if A–C are insufficient; avoid premature complexity. |

---

## 3. Proposed implementation phases

### Phase 0 — Contract and observability (high priority)

- **Types:** clearly separate *requested* (pure math output) from *resolved/materialized* (after `selectRowsForTargets`).
- **Persistence:** where dataset templates are stored, optionally persist `requestedRowCounts` (debug) but **`rowCounts` shown to users = actual** after materialization.
- **Logging:** when `sum(actual) < sum(requested)` or per-table drift exceeds a threshold → structured logs; may extend/reuse `importWarnings` post-import.
- **UI:** catalog/admin bind **actual** only; if pre-FK targets are shown, label them **“target (pre-FK)”**.

**Status (partial):** canonical SQL-dump import appends an `importWarnings` entry when derived materialized `rowCounts` differ from apportioned targets (FK-aware selection); DB still stores materialized counts only.

### Phase 1 — Replace core with largest remainder (A)

1. Compute `r_i = (count_i / totalRows) * target`, keeping current conventions for `target` (e.g. `max(tables with count > 0, floor(targetTotalRows))` if still desired).
2. Hamilton: `f_i = floor(r_i)`, assign remainder of `target - sum(f)` in descending fractional order.
3. Optional min-1 after this step (important tables only, or global + short rebalance).

**Deliverable:** something like `apportionIntegerTargets({ counts, targetTotal, options })`, multi-seed unit tests.

**Feature flag / env:** e.g. gradual rollout of Hamilton vs baseline.

**Status (implemented):** `largestRemainderApportion()` + `scaleDatasetRowCounts()` refactor in `apps/api/src/lib/dataset-scales.ts` (Hamilton, then min-one per table with rows, then rebalance loops as before).

### Phase 2 — Optional global min-1 removal (B), behind a flag

- `allowEmptyTablesInDerived` (default `false`).
- Validate `renderDerivedSqlDump` / DDL when a table has zero rows.
- Safe rules for FKs (parent/child).

**Status (implemented):** Request field `allowEmptyTablesInDerived` (see `DatasetScaleDownOptionsSchema` in `admin.schema.ts`). When true, integer `target` is not forced to `>= table count`, Hamilton may assign zero rows to some tables, and rebalance uses `minFloor = 0`. FK-aware materialization still applies downstream.

### Phase 3 — Stratification (C)

- Extend table metadata (`role: fact | dimension | …`) — may need admin UI.
- Heuristics are fallback only; document confidence limits.

**Status (implemented):** `inferTableRoles` + `tableScaleRoles` + `dimensionBudgetFraction` (default `0.15`). Roles may also come from `definition.metadata.tableScaleRoles` (merged with body). `inferTableScaleRoleFromName()` uses conservative name patterns; explicit roles win.

### Phase 4 — Quadratic optimization (D) — backlog

- Only if metrics justify it; cap table count to avoid slow imports.

**Status (implemented):** `useQuadraticRefinement` runs a bounded pairwise local search on \(\sum_i (a_i - r_i)^2\) after Hamilton + rebalance, respecting per-table source caps.

---

## 4. Relationship / FK risks (parallel track)

| Issue | Effect | Proposed action |
|-------|--------|-----------------|
| Schema definition **without** inline `references …` on columns | Empty `foreignKeys` → selection hits numeric targets **without closure** → orphans | (1) Extend parser: `ALTER TABLE … FOREIGN KEY` → merge into FK list. (2) Warn when FK metadata may be incomplete. (3) Optional: `strictFkMetadata` fails derived import. |
| **Cyclic FKs** (`cycleTables`) | FK checks skipped between tables in the cycle → possible skew | Document clearly; later improvements (multi-pass, etc.) — separate phase. |
| **Composite FKs** / detached `ALTER TABLE` constraints | Was not tracked | **Done:** `definition.tables[].foreignKeyConstraints`; tuple checks in `real-dataset-artifact`; `sql-dump-scan` parses CREATE/ALTER `FOREIGN KEY`, newline/`REFERENCES ONLY`, merges inline single-column `REFERENCES` into the same list. |
| **Requested vs actual** | UI/metadata use old targets → looks “full” but file has fewer rows | Phase 0: **actual** is the display source; optional admin dashboard for requested→actual diff. |

---

## 5. Testing strategy

- **Unit:** Hamilton / apportion — edge cases (small target, one dominant table, many single-row tables).
- **Integration:** extend `real-dataset-artifact.test.ts` — FK closure; add cases after `ALTER TABLE` parser exists.
- **Regression:** fixed golden dumps — compare row-count histogram or checksum before/after.
- **Contract:** explicit tests for `requested ≠ actual` when FKs constrain the subset.

---

## 6. Safe merge order

1. **Phase 0** — contract + logging + UI uses actual (no core algorithm swap yet).
2. **Phase 1** — Hamilton + flag.
3. **Phase 2** — empty tables + separate flag.
4. **Phase 3** — stratified + metadata.
5. **Phase 4** — when measurement warrants it.

---

## 7. Out of scope (note in PR/RFC)

- Changing SQL emission (e.g. `ORDER BY` in `COPY`) unless required.
- Supporting every dialect equally — prioritize the PostgreSQL path already used for derived datasets.

---

## 8. Code map

| Component | File |
|-----------|------|
| Tier thresholds, `scaleDatasetRowCounts`, `buildDerivedDatasetRowCounts` | `apps/api/src/lib/dataset-scales.ts` |
| Admin import & derived materialization | `apps/api/src/modules/admin/admin.service.ts` |
| Column schema + FK parsing (inline + stored constraints), row selection + single- and composite-FK checks | `apps/api/src/modules/admin/real-dataset-artifact.ts` |
| SQL dump `CREATE TABLE` / `ALTER TABLE` FK extraction | `apps/api/src/modules/admin/sql-dump-scan.ts` |
| FK closure tests | `apps/api/src/modules/admin/__tests__/real-dataset-artifact.test.ts` |

---

*This document captures the refactor plan; update completion dates per phase as work lands.*
