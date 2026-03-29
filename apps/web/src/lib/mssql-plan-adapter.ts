/**
 * Map SQL Server SHOWPLAN_XML (JSON from fast-xml-parser on the worker) into the
 * Postgres-shaped plan nodes {@link ExecutionPlanTree} already renders.
 */

export type PgShapedPlanNode = {
  'Node Type': string;
  'Plans'?: PgShapedPlanNode[];
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
  'Filter'?: string;
  'Index Cond'?: string;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
};

function asArray<T>(x: T | T[] | undefined | null): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function toNum(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

/** Strip bracket identifiers for display: [dbo].[t] → dbo.t */
function displayId(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  return raw.replace(/[\[\]]/g, '');
}

function sumThreadMetric(rel: Record<string, unknown>, attr: string): number | undefined {
  const rt = rel.RunTimeInformation;
  if (!isRecord(rt)) return undefined;
  const threads = asArray(rt.RunTimeCountersPerThread as Record<string, unknown> | Record<string, unknown>[]);
  let sum = 0;
  let any = false;
  for (const t of threads) {
    if (!isRecord(t)) continue;
    const n = toNum(t[`@_${attr}`] ?? t[attr]);
    if (n != null) {
      sum += n;
      any = true;
    }
  }
  return any ? sum : undefined;
}

function maxThreadMetric(rel: Record<string, unknown>, attr: string): number | undefined {
  const rt = rel.RunTimeInformation;
  if (!isRecord(rt)) return undefined;
  const threads = asArray(rt.RunTimeCountersPerThread as Record<string, unknown> | Record<string, unknown>[]);
  let max = 0;
  let any = false;
  for (const t of threads) {
    if (!isRecord(t)) continue;
    const n = toNum(t[`@_${attr}`] ?? t[attr]);
    if (n != null) {
      max = Math.max(max, n);
      any = true;
    }
  }
  return any ? max : undefined;
}

/**
 * Child RelOp nodes live under physical-operator elements (IndexScan, HashMatch, NestedLoops, …).
 */
function directRelOpChildren(rel: Record<string, unknown>): Record<string, unknown>[] {
  const kids: Record<string, unknown>[] = [];
  for (const [k, v] of Object.entries(rel)) {
    if (k.startsWith('@_') || k === 'OutputList' || k === 'RunTimeInformation') continue;
    if (k === 'RelOp') {
      for (const c of asArray(v)) {
        if (isRecord(c)) kids.push(c);
      }
      continue;
    }
    kids.push(...collectRelOpsFromOperatorSubtree(v));
  }
  return kids;
}

function collectRelOpsFromOperatorSubtree(node: unknown): Record<string, unknown>[] {
  if (!node) return [];
  if (Array.isArray(node)) return node.flatMap((x) => collectRelOpsFromOperatorSubtree(x));
  if (!isRecord(node)) return [];
  if (node.RelOp) {
    return asArray(node.RelOp).filter(isRecord);
  }
  const acc: Record<string, unknown>[] = [];
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith('@_')) continue;
    acc.push(...collectRelOpsFromOperatorSubtree(v));
  }
  return acc;
}

function findTableIndexObject(rel: Record<string, unknown>): Record<string, unknown> | undefined {
  const scanTags = [
    'IndexScan',
    'ClusteredIndexScan',
    'IndexSeek',
    'ClusteredIndexSeek',
    'TableScan',
    'ColumnStoreIndexScan',
    'ColumnStoreIndexSeek',
    'RemoteScan',
    'ForeignKeyReferencesScan',
  ];
  for (const tag of scanTags) {
    const block = rel[tag];
    if (!isRecord(block)) continue;
    const obj = block.Object;
    if (isRecord(obj) && (typeof obj['@_Table'] === 'string' || typeof obj['@_Index'] === 'string')) {
      return obj;
    }
  }
  for (const v of Object.values(rel)) {
    if (isRecord(v) || Array.isArray(v)) {
      const nested = deepFindObjectWithTable(v);
      if (nested) return nested;
    }
  }
  return undefined;
}

function deepFindObjectWithTable(node: unknown): Record<string, unknown> | undefined {
  if (!node) return undefined;
  if (Array.isArray(node)) {
    for (const x of node) {
      const f = deepFindObjectWithTable(x);
      if (f) return f;
    }
    return undefined;
  }
  if (!isRecord(node)) return undefined;
  if (typeof node['@_Table'] === 'string') return node;
  for (const v of Object.values(node)) {
    const f = deepFindObjectWithTable(v);
    if (f) return f;
  }
  return undefined;
}

function relOpToPgNode(rel: Record<string, unknown>): PgShapedPlanNode {
  const physical = typeof rel['@_PhysicalOp'] === 'string' ? rel['@_PhysicalOp'] : undefined;
  const logical = typeof rel['@_LogicalOp'] === 'string' ? rel['@_LogicalOp'] : undefined;
  const nodeType = physical ?? logical ?? 'RelOp';

  const obj = findTableIndexObject(rel);
  const schema = obj ? displayId(obj['@_Schema']) : undefined;
  const tableOnly = obj ? displayId(obj['@_Table']) : undefined;
  const table =
    schema && tableOnly ? `${schema}.${tableOnly}` : tableOnly ?? schema;
  const index = obj ? displayId(obj['@_Index']) : undefined;

  const childRels = directRelOpChildren(rel);
  const children = childRels.map((c) => relOpToPgNode(c));

  const actualRows = sumThreadMetric(rel, 'ActualRows');
  const actualMs = maxThreadMetric(rel, 'ActualElapsedms');

  return {
    'Node Type': nodeType,
    'Plans': children.length > 0 ? children : undefined,
    'Total Cost': toNum(rel['@_EstimatedTotalSubtreeCost']),
    'Plan Rows':
      toNum(rel['@_EstimateRows']) ??
      toNum(rel['@_EstimatedRowsRead']) ??
      toNum(rel['@_TableCardinality']),
    'Actual Rows': actualRows,
    'Actual Total Time': actualMs,
    'Actual Loops': 1,
    'Relation Name': table,
    'Index Name': index,
  };
}

function firstStmtRootRelOp(showPlanRoot: Record<string, unknown>): Record<string, unknown> | undefined {
  const batchSeq = showPlanRoot.BatchSequence;
  if (!isRecord(batchSeq)) return undefined;
  const batches = asArray(batchSeq.Batch as Record<string, unknown> | Record<string, unknown>[]);
  for (const batch of batches) {
    if (!isRecord(batch)) continue;
    const stmts = batch.Statements;
    if (!isRecord(stmts)) continue;
    const list = [
      ...asArray(stmts.StmtSimple as Record<string, unknown> | Record<string, unknown>[]),
      ...asArray(stmts.StmtCursor as Record<string, unknown> | Record<string, unknown>[]),
      ...asArray(stmts.StmtCond as Record<string, unknown> | Record<string, unknown>[]),
    ];
    for (const stmt of list) {
      if (!isRecord(stmt)) continue;
      const qp = stmt.QueryPlan;
      if (!isRecord(qp)) continue;
      const rel = qp.RelOp;
      const first = asArray(rel)[0];
      if (isRecord(first)) return first;
    }
  }
  return undefined;
}

/**
 * @param wrapped Worker payload: `{ engine, format, plan }` where `plan` contains `ShowPlanXML`.
 */
export function tryMssqlPlanToPgShapedRoot(wrapped: Record<string, unknown>): PgShapedPlanNode | null {
  if (wrapped.engine !== 'sqlserver') return null;
  const inner = wrapped.plan;
  if (!isRecord(inner)) return null;
  const show = (inner.ShowPlanXML ?? inner) as Record<string, unknown>;
  if (!isRecord(show)) return null;
  const rootRel = firstStmtRootRelOp(show);
  if (!rootRel) return null;
  return relOpToPgNode(rootRel);
}

export function isSqlServerWrappedPlan(plan: unknown): boolean {
  return isRecord(plan) && plan.engine === 'sqlserver';
}
