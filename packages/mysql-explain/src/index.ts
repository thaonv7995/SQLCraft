/**
 * Map MySQL EXPLAIN FORMAT=JSON into the Postgres-shaped plan tree
 * {@link ExecutionPlanTree} already renders.
 *
 * Keep in sync with `apps/web/src/lib/mysql-explain-adapter.ts` (Next bundler uses that copy).
 */

export type PgShapedPlanNode = {
  'Node Type': string;
  Plans?: PgShapedPlanNode[];
  'Relation Name'?: string;
  'Alias'?: string;
  'Index Name'?: string;
  'Startup Cost'?: number;
  'Total Cost'?: number;
  'Plan Rows'?: number;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Actual Startup Time'?: number;
  'Actual Total Time'?: number;
  Filter?: string;
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

function asArray<T>(x: T | T[] | undefined | null): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

/** MySQL nested_loop / block_nested_loop items are objects with table or nested structures. */
function asNestedLoopItems(x: unknown): Record<string, unknown>[] {
  return asArray(x).filter(isRecord);
}

function toNum(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function accessTypeToNodeType(accessType: string): string {
  const m: Record<string, string> = {
    ALL: 'Seq Scan',
    index: 'Index Scan',
    range: 'Index Range Scan',
    ref: 'Index Lookup (ref)',
    eq_ref: 'Unique Index Lookup (eq_ref)',
    const: 'Constant Row',
    system: 'System',
    fulltext: 'Fulltext Scan',
    index_merge: 'Index Merge',
    unique_subquery: 'Unique Subquery',
    index_subquery: 'Index Subquery',
    MRR: 'Multi-Range Read',
  };
  return m[accessType] ?? `Access (${accessType})`;
}

function tableToNode(table: Record<string, unknown>): PgShapedPlanNode {
  const accessType = typeof table.access_type === 'string' ? table.access_type : 'unknown';
  const nodeType = accessTypeToNodeType(accessType);
  const tableName =
    typeof table.table_name === 'string'
      ? table.table_name
      : typeof table.message === 'string'
        ? table.message
        : undefined;
  const key = typeof table.key === 'string' ? table.key : undefined;
  const costInfo = isRecord(table.cost_info) ? table.cost_info : undefined;
  const totalCost =
    toNum(costInfo?.prefix_cost) ??
    toNum(costInfo?.query_cost) ??
    toNum(costInfo?.read_cost) ??
    toNum(costInfo?.eval_cost);

  const planRows =
    toNum(table.rows_examined_per_scan) ??
    toNum(table.rows_produced_per_join) ??
    toNum(table.rows);

  const actualRows =
    toNum(table.actual_rows) ??
    toNum((table as Record<string, unknown>).actual_rows_examined) ??
    toNum((table as Record<string, unknown>).actual_rows_produced);

  const actualTotal =
    toNum((table as Record<string, unknown>).actual_last_row_ms) ??
    toNum((table as Record<string, unknown>).actual_time_last_row_ms) ??
    toNum((table as Record<string, unknown>).actual_time);

  const filterParts: string[] = [];
  if (typeof table.attached_condition === 'string' && table.attached_condition.length > 0) {
    filterParts.push(table.attached_condition);
  }
  if (typeof table.filtered === 'string' && table.filtered.length > 0) {
    filterParts.push(`filtered=${table.filtered}%`);
  }

  return {
    'Node Type': nodeType,
    'Relation Name': tableName,
    'Index Name': key,
    'Total Cost': totalCost,
    'Plan Rows': planRows,
    'Actual Rows': actualRows,
    'Actual Total Time': actualTotal,
    'Actual Loops': 1,
    Filter: filterParts.length > 0 ? filterParts.join(' · ') : undefined,
  };
}

function nestedLoopArrayToNode(items: Record<string, unknown>[]): PgShapedPlanNode {
  const plans = items.map(convertStep).filter((x): x is PgShapedPlanNode => x != null);
  if (plans.length === 0) {
    return { 'Node Type': 'Nested Loop' };
  }
  if (plans.length === 1) return plans[0];
  return {
    'Node Type': 'Nested Loop',
    Plans: plans,
  };
}

/**
 * MySQL puts total {@code query_cost} and (for joins) final row estimates on {@code query_block},
 * while {@code nested_loop} steps carry per-table costs/rows. The UI summary reads the root node,
 * so we merge query-level numbers onto the Postgres-shaped root when missing.
 */
function mergeQueryBlockSummary(qb: Record<string, unknown>, plan: PgShapedPlanNode): PgShapedPlanNode {
  const queryCost = isRecord(qb.cost_info) ? toNum(qb.cost_info.query_cost) : undefined;
  const out: PgShapedPlanNode = { ...plan };

  if (out['Total Cost'] == null && queryCost != null) {
    out['Total Cost'] = queryCost;
  }

  const plans = out.Plans;
  if (plans && plans.length > 0) {
    if (out['Plan Rows'] == null) {
      const last = plans[plans.length - 1];
      const lastRows = toNum(last['Plan Rows']);
      if (lastRows != null) {
        out['Plan Rows'] = lastRows;
      } else {
        const sumRows = plans.reduce((s, p) => s + (toNum(p['Plan Rows']) ?? 0), 0);
        if (sumRows > 0) {
          out['Plan Rows'] = sumRows;
        }
      }
    }

    if (out['Actual Total Time'] == null) {
      const parts = plans
        .map((p) => toNum(p['Actual Total Time']))
        .filter((t): t is number => t != null);
      if (parts.length > 0) {
        out['Actual Total Time'] = parts.reduce((a, b) => a + b, 0);
      }
    }
  }

  return out;
}

function convertStep(step: Record<string, unknown>): PgShapedPlanNode | null {
  if (isRecord(step.table)) {
    return tableToNode(step.table);
  }
  if (isRecord(step.buffered_table)) {
    const bt = step.buffered_table;
    if (isRecord(bt.table)) {
      const n = tableToNode(bt.table);
      n.Filter = n.Filter ? `${n.Filter} · buffered` : 'buffered';
      return n;
    }
  }
  if (step.nested_loop != null) {
    return nestedLoopArrayToNode(asNestedLoopItems(step.nested_loop));
  }
  if (isRecord(step.ordering_operation)) {
    return convertOrderingOperation(step.ordering_operation);
  }
  if (isRecord(step.grouping_operation)) {
    return convertGroupingOperation(step.grouping_operation);
  }
  if (isRecord(step.union_result)) {
    return convertUnionResult(step.union_result);
  }
  if (step.block_nested_loop != null) {
    return nestedLoopArrayToNode(asNestedLoopItems(step.block_nested_loop));
  }
  if (isRecord(step.materialized_from_subquery)) {
    return convertMaterializedFromSubquery(step.materialized_from_subquery);
  }
  if (isRecord(step.query_block)) {
    return convertQueryBlock(step.query_block);
  }
  if (isRecord(step.windowing_operation)) {
    return convertWindowingOperation(step.windowing_operation);
  }
  if (isRecord(step.duplicate_weedout)) {
    return convertDuplicateWeedout(step.duplicate_weedout);
  }
  return null;
}

function convertOrderingOperation(op: Record<string, unknown>): PgShapedPlanNode {
  const usingFilesort = op.using_filesort === true;
  const label = usingFilesort ? 'Sort' : 'Ordering';
  const inner =
    op.nested_loop != null
      ? nestedLoopArrayToNode(asNestedLoopItems(op.nested_loop))
      : op.table != null && isRecord(op.table)
        ? tableToNode(op.table)
        : null;
  if (!inner) {
    return { 'Node Type': label };
  }
  return {
    'Node Type': label,
    Plans: [inner],
  };
}

function convertGroupingOperation(op: Record<string, unknown>): PgShapedPlanNode {
  const tmp = op.using_temporary_table === true ? ' (temp table)' : '';
  const label = `Group By${tmp}`;
  const inner =
    op.nested_loop != null
      ? nestedLoopArrayToNode(asNestedLoopItems(op.nested_loop))
      : op.table != null && isRecord(op.table)
        ? tableToNode(op.table)
        : null;
  if (!inner) {
    return { 'Node Type': label };
  }
  return {
    'Node Type': label,
    Plans: [inner],
  };
}

function convertUnionResult(ur: Record<string, unknown>): PgShapedPlanNode {
  const tables = asArray(ur.union_table as Record<string, unknown> | Record<string, unknown>[]);
  const plans: PgShapedPlanNode[] = [];
  for (const t of tables) {
    if (!isRecord(t)) continue;
    if (isRecord(t.query_block)) {
      const c = convertQueryBlock(t.query_block);
      if (c) plans.push(c);
    }
  }
  if (plans.length === 0) {
    return { 'Node Type': 'Union' };
  }
  return {
    'Node Type': 'Union',
    Plans: plans,
  };
}

function convertMaterializedFromSubquery(m: Record<string, unknown>): PgShapedPlanNode {
  const inner = isRecord(m.query_block) ? convertQueryBlock(m.query_block) : null;
  if (!inner) {
    return { 'Node Type': 'Materialized Subquery' };
  }
  return {
    'Node Type': 'Materialized Subquery',
    Plans: [inner],
  };
}

function convertWindowingOperation(w: Record<string, unknown>): PgShapedPlanNode {
  const inner =
    w.nested_loop != null
      ? nestedLoopArrayToNode(asNestedLoopItems(w.nested_loop))
      : w.table != null && isRecord(w.table)
        ? tableToNode(w.table)
        : null;
  if (!inner) {
    return { 'Node Type': 'Window' };
  }
  return {
    'Node Type': 'Window',
    Plans: [inner],
  };
}

function convertDuplicateWeedout(d: Record<string, unknown>): PgShapedPlanNode {
  const inner =
    d.nested_loop != null
      ? nestedLoopArrayToNode(asNestedLoopItems(d.nested_loop))
      : null;
  if (!inner) {
    return { 'Node Type': 'Duplicate Weedout' };
  }
  return {
    'Node Type': 'Duplicate Weedout',
    Plans: [inner],
  };
}

function convertQueryBlock(qb: Record<string, unknown>): PgShapedPlanNode | null {
  if (isRecord(qb.table)) {
    return tableToNode(qb.table);
  }
  if (qb.nested_loop != null) {
    return mergeQueryBlockSummary(qb, nestedLoopArrayToNode(asNestedLoopItems(qb.nested_loop)));
  }
  if (isRecord(qb.ordering_operation)) {
    return convertOrderingOperation(qb.ordering_operation);
  }
  if (isRecord(qb.grouping_operation)) {
    return convertGroupingOperation(qb.grouping_operation);
  }
  if (isRecord(qb.union_result)) {
    return convertUnionResult(qb.union_result);
  }
  if (isRecord(qb.windowing_operation)) {
    return convertWindowingOperation(qb.windowing_operation);
  }
  const selectId = qb.select_id;
  const idLabel = selectId != null ? ` #${selectId}` : '';
  return {
    'Node Type': `Query Block${idLabel}`,
    'Total Cost': isRecord(qb.cost_info) ? toNum(qb.cost_info.query_cost) : undefined,
  };
}

/**
 * Returns a Postgres-shaped `{ Plan: root }` or null if the payload is not MySQL EXPLAIN JSON.
 */
export function mysqlExplainJsonToPgShaped(raw: unknown): { Plan: PgShapedPlanNode } | null {
  if (raw == null) return null;
  let obj: unknown = raw;
  if (Array.isArray(obj) && obj.length > 0) {
    obj = obj[0];
  }
  if (typeof obj === 'string') return null;
  if (!isRecord(obj)) return null;

  if (isRecord(obj.Plan) && typeof obj.Plan['Node Type'] === 'string') {
    return obj as { Plan: PgShapedPlanNode };
  }

  const root = isRecord(obj.query_block) ? obj.query_block : obj;
  if (!isRecord(root)) return null;

  const plan = convertQueryBlock(root);
  if (!plan) return null;
  return { Plan: plan };
}

/** For UI: unwrap to a single root node (same as Postgres `Plan`). */
export function tryMysqlJsonToPgRoot(plan: unknown): PgShapedPlanNode | null {
  const wrapped = mysqlExplainJsonToPgShaped(plan);
  return wrapped?.Plan ?? null;
}
