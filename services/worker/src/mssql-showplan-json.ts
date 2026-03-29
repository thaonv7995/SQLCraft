import { XMLParser } from 'fast-xml-parser';

function toFiniteMetric(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function asArray<T>(x: T | T[] | undefined | null): T[] {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

/**
 * Parse SQL Server SHOWPLAN_XML / STATISTICS XML into a plain JSON tree (attributes use @_ prefix).
 */
export function parseMssqlShowPlanXml(xml: string): unknown {
  const trimmed = xml.trim();
  if (!trimmed.startsWith('<')) {
    throw new Error('Expected ShowPlan XML');
  }
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    removeNSPrefix: true,
    trimValues: true,
  });
  return parser.parse(trimmed);
}

export interface MssqlPlanSummary {
  nodeType?: string;
  totalCost?: number;
  actualRows?: number;
  actualTime?: number;
}

function firstRootRelOp(stmt: Record<string, unknown>): Record<string, unknown> | undefined {
  const qp = stmt.QueryPlan;
  if (!qp || typeof qp !== 'object') return undefined;
  const rel = (qp as Record<string, unknown>).RelOp;
  const first = asArray(rel as Record<string, unknown> | Record<string, unknown>[] | undefined)[0];
  return first && typeof first === 'object' ? (first as Record<string, unknown>) : undefined;
}

function sumRuntimeActualRows(relOp: Record<string, unknown>): number | undefined {
  const rt = relOp.RunTimeInformation;
  if (!rt || typeof rt !== 'object') return undefined;
  const threads = asArray(
    (rt as Record<string, unknown>).RunTimeCountersPerThread as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined,
  );
  let sum = 0;
  let any = false;
  for (const t of threads) {
    const n = toFiniteMetric(t['@_ActualRows']);
    if (n != null) {
      sum += n;
      any = true;
    }
  }
  return any ? sum : undefined;
}

function maxRuntimeElapsedMs(relOp: Record<string, unknown>): number | undefined {
  const rt = relOp.RunTimeInformation;
  if (!rt || typeof rt !== 'object') return undefined;
  const threads = asArray(
    (rt as Record<string, unknown>).RunTimeCountersPerThread as
      | Record<string, unknown>
      | Record<string, unknown>[]
      | undefined,
  );
  let max = 0;
  let any = false;
  for (const t of threads) {
    const n = toFiniteMetric(t['@_ActualElapsedms']);
    if (n != null) {
      max = Math.max(max, n);
      any = true;
    }
  }
  return any ? max : undefined;
}

/**
 * Best-effort summary aligned with {@link ExplainResult.planSummary} for Postgres/MySQL.
 */
export function summarizeMssqlShowPlan(parsed: unknown): MssqlPlanSummary {
  if (!parsed || typeof parsed !== 'object') return {};
  const doc = parsed as Record<string, unknown>;
  const root = (doc.ShowPlanXML ?? doc) as Record<string, unknown>;
  const batchSeq = root.BatchSequence as Record<string, unknown> | undefined;
  if (!batchSeq) return {};

  const batches = asArray(batchSeq.Batch as Record<string, unknown> | Record<string, unknown>[] | undefined);
  for (const batch of batches) {
    const stmts = batch.Statements as Record<string, unknown> | undefined;
    if (!stmts) continue;
    const stmtList = [
      ...asArray(stmts.StmtSimple as Record<string, unknown> | Record<string, unknown>[] | undefined),
      ...asArray(stmts.StmtCursor as Record<string, unknown> | Record<string, unknown>[] | undefined),
      ...asArray(stmts.StmtCond as Record<string, unknown> | Record<string, unknown>[] | undefined),
    ];
    for (const stmt of stmtList) {
      if (!stmt || typeof stmt !== 'object') continue;
      const s = stmt as Record<string, unknown>;
      const subtreeCost = toFiniteMetric(s['@_StatementSubTreeCost']);
      const rel = firstRootRelOp(s);
      const physical = typeof rel?.['@_PhysicalOp'] === 'string' ? rel['@_PhysicalOp'] : undefined;
      const estSubtree = toFiniteMetric(rel?.['@_EstimatedTotalSubtreeCost']);
      const actualRows = rel ? sumRuntimeActualRows(rel) : undefined;
      const actualTime = rel ? maxRuntimeElapsedMs(rel) : undefined;

      return {
        nodeType: physical,
        totalCost: subtreeCost ?? estSubtree,
        actualRows,
        actualTime,
      };
    }
  }

  return {};
}

/** Wrapper stored as {@link ExplainResult.rawPlan} for SQL Server EXPLAIN. */
export function wrapMssqlShowPlanJson(parsed: unknown): Record<string, unknown> {
  const doc = parsed as Record<string, unknown>;
  const root = (doc.ShowPlanXML ?? doc) as Record<string, unknown> | undefined;
  const version = typeof root?.['@_Version'] === 'string' ? root['@_Version'] : undefined;
  return {
    engine: 'sqlserver',
    format: 'showplan_xml',
    version,
    plan: parsed,
  };
}
