import type { PassCriterionPayload } from '@/lib/api';

/**
 * Human-readable pass criteria aligned with `evaluateAttempt` in challenges.service.ts.
 * Does not expose reference SQL.
 */
export type ChallengePassCriteriaSource = {
  validatorType: string;
  validatorConfig?: Record<string, unknown> | null;
  /** Max points when all pass conditions are met (see evaluateAttempt). */
  points?: number;
};

export type ChallengeValidatorMetrics = {
  baselineDurationMs: number | null;
  /** EXPLAIN total cost ceiling for pass (`maxTotalCost` on server). */
  maxTotalCost: number | null;
  requiresIndexOptimization: boolean;
};

function rowKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `row-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** One required output column tied to a schema table (table may be "" for legacy data). */
export type OutputColumnSelection = { table: string; column: string };

/** One UI row: pick a table, then columns (shown as chips). */
export type RequiredOutputColumnGroup = {
  key: string;
  table: string;
  columns: string[];
};

export function newRequiredOutputColumnGroup(): RequiredOutputColumnGroup {
  return { key: rowKey(), table: '', columns: [] };
}

export type PassCriterionDraft =
  | { key: string; type: 'max_query_duration_ms'; maxMs: number }
  | { key: string; type: 'max_explain_total_cost'; maxTotalCost: number }
  | { key: string; type: 'requires_index_usage' }
  | { key: string; type: 'required_output_columns'; groups: RequiredOutputColumnGroup[] }
  | { key: string; type: 'required_tables_in_query'; tablesRaw: string; matchMode: 'all' | 'any' };

export function newPassCriterionDraft(
  type: PassCriterionDraft['type'],
  key?: string,
): PassCriterionDraft {
  const k = key ?? rowKey();
  switch (type) {
    case 'max_query_duration_ms':
      return { key: k, type, maxMs: 5000 };
    case 'max_explain_total_cost':
      return { key: k, type, maxTotalCost: 10_000 };
    case 'requires_index_usage':
      return { key: k, type };
    case 'required_output_columns':
      return { key: k, type, groups: [newRequiredOutputColumnGroup()] };
    case 'required_tables_in_query':
      return { key: k, type, tablesRaw: '', matchMode: 'all' };
  }
}

function splitList(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Flatten groups → API `selections` / evaluation pairs. */
export function selectionsFromGroups(groups: RequiredOutputColumnGroup[]): OutputColumnSelection[] {
  const out: OutputColumnSelection[] = [];
  for (const g of groups) {
    const t = g.table.trim();
    for (const col of g.columns) {
      const c = col.trim();
      if (!c) continue;
      out.push({ table: t, column: c });
    }
  }
  return out;
}

/** Stored selections / legacy columns → editor groups (table order preserved). */
export function groupsFromSelections(selections: OutputColumnSelection[]): RequiredOutputColumnGroup[] {
  const tableOrder: string[] = [];
  const byTable = new Map<string, string[]>();
  for (const s of selections) {
    const t = typeof s.table === 'string' ? s.table : '';
    const c = (s.column ?? '').trim();
    if (!c) continue;
    if (!byTable.has(t)) {
      byTable.set(t, []);
      tableOrder.push(t);
    }
    const arr = byTable.get(t)!;
    if (!arr.some((x) => x.toLowerCase() === c.toLowerCase())) arr.push(c);
  }
  if (tableOrder.length === 0) {
    return [{ key: rowKey(), table: '', columns: [] }];
  }
  return tableOrder.map((t) => ({
    key: rowKey(),
    table: t,
    columns: byTable.get(t) ?? [],
  }));
}

/** Column names for API / pass check: unique by case-insensitive name, first occurrence wins. */
export function columnNamesFromSelections(selections: OutputColumnSelection[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of selections) {
    const col = s.column.trim();
    if (!col) continue;
    const lower = col.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(col);
  }
  return out;
}

function criterionFromApi(item: unknown): PassCriterionDraft | null {
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;
  const t = o.type;
  const key = rowKey();
  if (t === 'max_query_duration_ms') {
    const maxMs = typeof o.maxMs === 'number' && o.maxMs > 0 ? o.maxMs : 5000;
    return { key, type: t, maxMs };
  }
  if (t === 'max_explain_total_cost') {
    const maxTotalCost =
      typeof o.maxTotalCost === 'number' && o.maxTotalCost > 0 ? o.maxTotalCost : 10_000;
    return { key, type: t, maxTotalCost };
  }
  if (t === 'requires_index_usage') {
    return { key, type: t };
  }
  if (t === 'required_output_columns') {
    const selIn = o.selections;
    if (Array.isArray(selIn) && selIn.length > 0) {
      const selections: OutputColumnSelection[] = [];
      for (const item of selIn) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const column = typeof rec.column === 'string' ? rec.column.trim() : '';
        if (!column) continue;
        const table = typeof rec.table === 'string' ? rec.table : '';
        selections.push({ table, column });
      }
      if (selections.length > 0) {
        return { key, type: t, groups: groupsFromSelections(selections) };
      }
    }
    if (Array.isArray(o.columns)) {
      const columns = o.columns.filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
      const selections = columns.map((column) => ({ table: '', column }));
      return { key, type: t, groups: groupsFromSelections(selections) };
    }
  }
  if (t === 'required_tables_in_query' && Array.isArray(o.tables)) {
    const tables = o.tables.filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
    const matchMode = o.matchMode === 'any' ? 'any' : 'all';
    return { key, type: t, tablesRaw: tables.join(', '), matchMode };
  }
  return null;
}

/** Load editor rows from stored `validatorConfig` (passCriteria or legacy flat keys). */
export function passCriteriaDraftsFromConfig(
  validatorConfig?: Record<string, unknown> | null,
): PassCriterionDraft[] {
  const cfg = validatorConfig && typeof validatorConfig === 'object' ? validatorConfig : {};
  const pc = cfg.passCriteria;
  if (Array.isArray(pc) && pc.length > 0) {
    const out = pc.map((item) => criterionFromApi(item)).filter(Boolean) as PassCriterionDraft[];
    if (out.length > 0) return out;
  }

  const rows: PassCriterionDraft[] = [];
  const b = cfg.baselineDurationMs;
  const maxMs =
    typeof b === 'number' && Number.isFinite(b) && b > 0
      ? b
      : typeof b === 'string' && Number.isFinite(Number(b)) && Number(b) > 0
        ? Number(b)
        : null;
  if (maxMs != null) {
    rows.push({ key: rowKey(), type: 'max_query_duration_ms', maxMs });
  }

  const c = cfg.maxTotalCost;
  const maxCost =
    typeof c === 'number' && Number.isFinite(c) && c > 0
      ? c
      : typeof c === 'string' && Number.isFinite(Number(c)) && Number(c) > 0
        ? Number(c)
        : null;
  if (maxCost != null) {
    rows.push({ key: rowKey(), type: 'max_explain_total_cost', maxTotalCost: maxCost });
  }

  if (cfg.requiresIndexOptimization === true) {
    rows.push(newPassCriterionDraft('requires_index_usage'));
  }

  if (rows.length === 0) {
    return [newPassCriterionDraft('max_query_duration_ms'), newPassCriterionDraft('max_explain_total_cost')];
  }
  return rows;
}

/**
 * Read-only load for detail views: same migration as {@link passCriteriaDraftsFromConfig}
 * but does **not** inject default duration/cost rows when the config is empty.
 */
export function passCriteriaDraftsFromConfigReadOnly(
  validatorConfig?: Record<string, unknown> | null,
): PassCriterionDraft[] {
  const cfg = validatorConfig && typeof validatorConfig === 'object' ? validatorConfig : {};
  const pc = cfg.passCriteria;
  if (Array.isArray(pc) && pc.length > 0) {
    const out = pc.map((item) => criterionFromApi(item)).filter(Boolean) as PassCriterionDraft[];
    if (out.length > 0) return out;
  }

  const rows: PassCriterionDraft[] = [];
  const b = cfg.baselineDurationMs;
  const maxMs =
    typeof b === 'number' && Number.isFinite(b) && b > 0
      ? b
      : typeof b === 'string' && Number.isFinite(Number(b)) && Number(b) > 0
        ? Number(b)
        : null;
  if (maxMs != null) {
    rows.push({ key: rowKey(), type: 'max_query_duration_ms', maxMs });
  }

  const c = cfg.maxTotalCost;
  const maxCost =
    typeof c === 'number' && Number.isFinite(c) && c > 0
      ? c
      : typeof c === 'string' && Number.isFinite(Number(c)) && Number(c) > 0
        ? Number(c)
        : null;
  if (maxCost != null) {
    rows.push({ key: rowKey(), type: 'max_explain_total_cost', maxTotalCost: maxCost });
  }

  if (cfg.requiresIndexOptimization === true) {
    rows.push(newPassCriterionDraft('requires_index_usage'));
  }

  return rows;
}

/** Narrative lines for challenge detail: never duplicates structured pass rules (those are shown as rows). */
export function getChallengePassCriteriaExplainerLines(source: ChallengePassCriteriaSource): string[] {
  const lines: string[] = [];

  lines.push(
    'Truy vấn phải chạy thành công (không lỗi) và có trả về kết quả khi challenge yêu cầu tập dòng.',
  );

  if (source.validatorType === 'result_set') {
    lines.push(
      'Kết quả được so với đáp án chuẩn: cùng số cột, cùng thứ tự và tên cột (so khớp không phân biệt hoa thường từng vị trí), cùng số dòng, và tập giá trị các dòng trùng khớp (thứ tự dòng không quan trọng).',
    );
  } else {
    lines.push(`Loại chấm: ${source.validatorType} (chi tiết theo cấu hình nội bộ).`);
  }

  const drafts = passCriteriaDraftsFromConfigReadOnly(source.validatorConfig);
  if (drafts.length === 0) {
    const { baselineDurationMs, maxTotalCost, requiresIndexOptimization } =
      parseChallengeValidatorMetrics(source.validatorConfig);

    if (baselineDurationMs != null) {
      lines.push(
        `Thời gian thực thi truy vấn phải ≤ ${baselineDurationMs.toLocaleString()} ms mới pass (đo trên sandbox).`,
      );
    } else {
      lines.push('Không có ngưỡng thời gian cụ thể trong phiên bản này.');
    }

    if (maxTotalCost != null) {
      lines.push(
        `Tổng cost kế hoạch (PostgreSQL EXPLAIN, total cost) phải ≤ ${maxTotalCost.toLocaleString()} mới pass.`,
      );
    } else {
      lines.push('Không có ngưỡng cost EXPLAIN cụ thể trong phiên bản này.');
    }

    if (requiresIndexOptimization) {
      lines.push(
        'Plan thực thi phải cho thấy sử dụng index; có thể cần chạy CREATE INDEX trong phiên làm việc trước câu truy vấn cuối.',
      );
    }
  }

  if (
    typeof source.points === 'number' &&
    Number.isFinite(source.points) &&
    source.points > 0
  ) {
    lines.push(
      `Đạt đủ mọi điều kiện trên thì nhận trọn ${source.points.toLocaleString()} điểm; thiếu một điều kiện thì 0 điểm cho lần chấm đó.`,
    );
  }

  lines.push(
    'Bảng xếp hạng challenge chỉ liệt kê người đã pass; trong đó thứ hạng ưu tiên thời gian chạy query ngắn hơn, nếu trùng thì cost (ước lượng PostgreSQL từ EXPLAIN) thấp hơn xếp trên.',
  );

  return lines;
}

/** Build API payload; throws if validation fails. */
export function passCriteriaDraftsToPayload(rows: PassCriterionDraft[]): { passCriteria: PassCriterionPayload[] } {
  if (rows.length === 0) {
    throw new Error('Cần ít nhất một tiêu chí pass.');
  }

  const passCriteria: PassCriterionPayload[] = [];

  for (const row of rows) {
    switch (row.type) {
      case 'max_query_duration_ms':
        if (!Number.isFinite(row.maxMs) || row.maxMs <= 0) {
          throw new Error('Max query duration phải là số dương (ms).');
        }
        passCriteria.push({ type: row.type, maxMs: row.maxMs });
        break;
      case 'max_explain_total_cost':
        if (!Number.isFinite(row.maxTotalCost) || row.maxTotalCost <= 0) {
          throw new Error('Max EXPLAIN total cost phải là số dương.');
        }
        passCriteria.push({ type: row.type, maxTotalCost: row.maxTotalCost });
        break;
      case 'requires_index_usage':
        passCriteria.push({ type: row.type });
        break;
      case 'required_output_columns': {
        const selections = selectionsFromGroups(row.groups);
        const columns = columnNamesFromSelections(selections);
        if (columns.length === 0) {
          throw new Error('Tiêu chí “required columns” cần ít nhất một cột (chọn bảng rồi chọn cột).');
        }
        passCriteria.push({
          type: row.type,
          columns,
          ...(selections.length > 0
            ? { selections: selections.filter((s) => s.column.trim()) }
            : {}),
        });
        break;
      }
      case 'required_tables_in_query': {
        const tables = splitList(row.tablesRaw);
        if (tables.length === 0) {
          throw new Error('Tiêu chí “required tables” cần ít nhất một tên bảng.');
        }
        passCriteria.push({
          type: row.type,
          tables,
          matchMode: row.matchMode,
        });
        break;
      }
    }
  }

  return { passCriteria };
}

/** Sync `expectedResultColumns` from all `required_output_columns` rules (deduped). */
export function expectedResultColumnsFromPassCriteriaRows(
  rows: PassCriterionDraft[],
): string[] | undefined {
  try {
    const { passCriteria } = passCriteriaDraftsToPayload(rows);
    const cols = passCriteria.flatMap((c) =>
      c.type === 'required_output_columns' ? c.columns : [],
    );
    const uniq = [...new Set(cols)];
    return uniq.length > 0 ? uniq : undefined;
  } catch {
    return undefined;
  }
}

export type ParsedPassCriterion = {
  type: string;
  label: string;
};

function pushCriterionLabel(items: ParsedPassCriterion[], raw: Record<string, unknown>): void {
  const t = raw.type;
  if (t === 'max_query_duration_ms' && typeof raw.maxMs === 'number' && raw.maxMs > 0) {
    items.push({
      type: t,
      label: `Thời gian chạy query ≤ ${raw.maxMs.toLocaleString()} ms`,
    });
    return;
  }
  if (t === 'max_explain_total_cost' && typeof raw.maxTotalCost === 'number' && raw.maxTotalCost > 0) {
    items.push({
      type: t,
      label: `EXPLAIN total cost ≤ ${raw.maxTotalCost.toLocaleString()}`,
    });
    return;
  }
  if (t === 'requires_index_usage') {
    items.push({
      type: t,
      label: 'Plan phải thể hiện dùng index (và có CREATE INDEX trong phiên nếu cần)',
    });
    return;
  }
  if (t === 'required_output_columns' && Array.isArray(raw.columns)) {
    const columns = raw.columns.filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
    if (columns.length > 0) {
      const sel = raw.selections;
      if (Array.isArray(sel) && sel.length > 0) {
        const parts = sel
          .filter((x): x is { table?: string; column?: string } => x && typeof x === 'object')
          .map((x) => {
            const table = typeof x.table === 'string' ? x.table.trim() : '';
            const col = typeof x.column === 'string' ? x.column.trim() : '';
            if (!col) return '';
            return table ? `${table}.${col}` : col;
          })
          .filter(Boolean);
        if (parts.length > 0) {
          items.push({ type: t, label: `Kết quả phải có các cột: ${parts.join(', ')}` });
          return;
        }
      }
      items.push({ type: t, label: `Kết quả phải có các cột: ${columns.join(', ')}` });
    }
    return;
  }
  if (t === 'required_tables_in_query' && Array.isArray(raw.tables)) {
    const tables = raw.tables.filter((c): c is string => typeof c === 'string' && c.trim().length > 0);
    if (tables.length > 0) {
      const mode = raw.matchMode === 'any' ? 'any' : 'all';
      items.push({
        type: t,
        label:
          mode === 'any'
            ? `SQL phải tham chiếu ít nhất một bảng: ${tables.join(', ')}`
            : `SQL phải tham chiếu tất cả bảng: ${tables.join(', ')}`,
      });
    }
  }
}

/** Flatten config into display lines for metrics / help text. */
export function listPassCriteriaForDisplay(
  validatorConfig?: Record<string, unknown> | null,
): ParsedPassCriterion[] {
  const cfg = validatorConfig && typeof validatorConfig === 'object' ? validatorConfig : {};
  const items: ParsedPassCriterion[] = [];

  const pc = cfg.passCriteria;
  if (Array.isArray(pc) && pc.length > 0) {
    for (const raw of pc) {
      if (raw && typeof raw === 'object') {
        pushCriterionLabel(items, raw as Record<string, unknown>);
      }
    }
    if (items.length > 0) return items;
  }

  try {
    const { passCriteria } = passCriteriaDraftsToPayload(passCriteriaDraftsFromConfig(cfg));
    for (const p of passCriteria) {
      pushCriterionLabel(items, p as unknown as Record<string, unknown>);
    }
  } catch {
    /* empty */
  }
  return items;
}

/** Parsed from `validatorConfig` (passCriteria or legacy keys — first duration/cost for leaderboard hints). */
export function parseChallengeValidatorMetrics(
  validatorConfig?: Record<string, unknown> | null,
): ChallengeValidatorMetrics {
  const lines = listPassCriteriaForDisplay(validatorConfig);
  let baselineDurationMs: number | null = null;
  let maxTotalCost: number | null = null;
  let requiresIndexOptimization = false;

  const cfg = validatorConfig && typeof validatorConfig === 'object' ? validatorConfig : {};
  const pc = cfg.passCriteria;
  if (Array.isArray(pc)) {
    for (const c of pc) {
      if (!c || typeof c !== 'object') continue;
      const o = c as Record<string, unknown>;
      if (o.type === 'max_query_duration_ms' && typeof o.maxMs === 'number' && o.maxMs > 0) {
        if (baselineDurationMs === null) baselineDurationMs = o.maxMs;
      }
      if (o.type === 'max_explain_total_cost' && typeof o.maxTotalCost === 'number' && o.maxTotalCost > 0) {
        if (maxTotalCost === null) maxTotalCost = o.maxTotalCost;
      }
      if (o.type === 'requires_index_usage') requiresIndexOptimization = true;
    }
  }

  if (baselineDurationMs === null && typeof cfg.baselineDurationMs === 'number' && cfg.baselineDurationMs > 0) {
    baselineDurationMs = cfg.baselineDurationMs;
  }
  if (maxTotalCost === null && typeof cfg.maxTotalCost === 'number' && cfg.maxTotalCost > 0) {
    maxTotalCost = cfg.maxTotalCost;
  }
  if (!requiresIndexOptimization && cfg.requiresIndexOptimization === true) {
    requiresIndexOptimization = true;
  }

  if (lines.length === 0) {
    return { baselineDurationMs, maxTotalCost, requiresIndexOptimization };
  }

  return { baselineDurationMs, maxTotalCost, requiresIndexOptimization };
}

export function getChallengePassCriteriaLines(source: ChallengePassCriteriaSource): string[] {
  const { baselineDurationMs: baselineMs, maxTotalCost, requiresIndexOptimization } =
    parseChallengeValidatorMetrics(source.validatorConfig);

  const lines: string[] = [];

  lines.push('Truy vấn phải chạy thành công (không lỗi) và có trả về kết quả khi challenge yêu cầu tập dòng.');

  if (source.validatorType === 'result_set') {
    lines.push(
      'Kết quả được so với đáp án chuẩn: cùng số cột, cùng thứ tự và tên cột (so khớp không phân biệt hoa thường từng vị trí), cùng số dòng, và tập giá trị các dòng trùng khớp (thứ tự dòng không quan trọng).',
    );
  } else {
    lines.push(`Loại chấm: ${source.validatorType} (chi tiết theo cấu hình nội bộ).`);
  }

  const listed = listPassCriteriaForDisplay(source.validatorConfig);
  if (listed.length > 0) {
    lines.push('Tiêu chí pass (tất cả phải đạt):');
    for (const x of listed) {
      lines.push(`— ${x.label}`);
    }
  } else {
    if (baselineMs !== null) {
      lines.push(
        `Thời gian thực thi truy vấn phải ≤ ${baselineMs.toLocaleString()} ms mới pass (đo trên sandbox).`,
      );
    } else {
      lines.push('(Dữ liệu cũ) Không có ngưỡng thời gian — pass không kiểm tra runtime.');
    }

    if (maxTotalCost !== null) {
      lines.push(
        `Tổng cost kế hoạch (PostgreSQL EXPLAIN, total cost) phải ≤ ${maxTotalCost.toLocaleString()} mới pass.`,
      );
    } else {
      lines.push('(Dữ liệu cũ) Không có ngưỡng cost — pass không kiểm tra EXPLAIN total cost.');
    }

    if (requiresIndexOptimization) {
      lines.push(
        'Plan thực thi phải cho thấy sử dụng index; có thể cần chạy CREATE INDEX trong phiên làm việc trước câu truy vấn cuối.',
      );
    }
  }

  if (
    typeof source.points === 'number' &&
    Number.isFinite(source.points) &&
    source.points > 0
  ) {
    lines.push(
      `Đạt đủ mọi điều kiện trên thì nhận trọn ${source.points.toLocaleString()} điểm; thiếu một điều kiện thì 0 điểm cho lần chấm đó.`,
    );
  }

  lines.push(
    'Bảng xếp hạng challenge chỉ liệt kê người đã pass; trong đó thứ hạng ưu tiên thời gian chạy query ngắn hơn, nếu trùng thì cost (ước lượng PostgreSQL từ EXPLAIN) thấp hơn xếp trên.',
  );

  return lines;
}
