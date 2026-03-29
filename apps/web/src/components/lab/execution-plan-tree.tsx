import type { QueryExecutionPlan } from '@/lib/api';
import { isSqlServerWrappedPlan, tryMssqlPlanToPgShapedRoot } from '@/lib/mssql-plan-adapter';
import { tryMysqlJsonToPgRoot } from '@/lib/mysql-explain-adapter';
import { cn, formatDuration, formatPlannerEstimatedCost, formatRows } from '@/lib/utils';

type PgPlanNode = {
  'Node Type'?: string;
  'Plans'?: PgPlanNode[];
  'Relation Name'?: string;
  'Alias'?: string;
  'Parent Relationship'?: string;
  'Join Type'?: string;
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
  'Hash Cond'?: string;
  'Merge Cond'?: string;
  'Recheck Cond'?: string;
  'Shared Hit Blocks'?: number;
  'Shared Read Blocks'?: number;
};

type PlanBadgeTone = 'danger' | 'warning' | 'success' | 'neutral';
type AccessPathType = 'index' | 'sequential' | null;

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getPlanRoot(plan: unknown): PgPlanNode | null {
  if (!plan || typeof plan !== 'object') {
    return null;
  }

  const raw = plan as Record<string, unknown>;

  if (isSqlServerWrappedPlan(raw)) {
    return tryMssqlPlanToPgShapedRoot(raw) as PgPlanNode | null;
  }

  if (raw.Plan && typeof raw.Plan === 'object') {
    return raw.Plan as PgPlanNode;
  }

  const mysqlAsPg = tryMysqlJsonToPgRoot(raw);
  if (mysqlAsPg) {
    return mysqlAsPg as PgPlanNode;
  }

  if (typeof raw['Node Type'] === 'string') {
    return raw as PgPlanNode;
  }

  return null;
}

function getChildren(node: PgPlanNode): PgPlanNode[] {
  return Array.isArray(node.Plans) ? node.Plans : [];
}

function getNodeType(node: PgPlanNode): string {
  return node['Node Type'] ?? 'Plan Node';
}

function getRelationLabel(node: PgPlanNode): string | null {
  const relation = node['Relation Name'];
  const indexName = node['Index Name'];

  if (relation && indexName) {
    return `${relation} via ${indexName}`;
  }

  if (relation) {
    return relation;
  }

  if (indexName) {
    return indexName;
  }

  return null;
}

function getActualTime(node: PgPlanNode): number | undefined {
  return toNumber(node['Actual Total Time']);
}

function getTotalCost(node: PgPlanNode): number | undefined {
  return toNumber(node['Total Cost']);
}

function getScannedRows(node: PgPlanNode): number | undefined {
  const actualRows = toNumber(node['Actual Rows']);
  const actualLoops = toNumber(node['Actual Loops']) ?? 1;

  if (actualRows != null) {
    return actualRows * actualLoops;
  }

  return toNumber(node['Plan Rows']);
}

function getBufferStats(node: PgPlanNode): { hits?: number; reads?: number } {
  return {
    hits: toNumber(node['Shared Hit Blocks']),
    reads: toNumber(node['Shared Read Blocks']),
  };
}

function getAccessPathType(node: PgPlanNode): AccessPathType {
  const nodeType = getNodeType(node).toLowerCase();

  if (nodeType.includes('index')) {
    return 'index';
  }

  if (nodeType.includes('seq scan')) {
    return 'sequential';
  }

  if (nodeType.includes('table scan') && !nodeType.includes('index')) {
    return 'sequential';
  }

  return null;
}

function getNodeHighlight(
  node: PgPlanNode,
  rootActualTime?: number,
  timeShareSource = 'EXPLAIN ANALYZE',
): {
  label: string;
  reason: string;
  tone: PlanBadgeTone;
} | null {
  const actualTime = getActualTime(node);
  const scannedRows = getScannedRows(node) ?? 0;
  const totalCost = getTotalCost(node) ?? 0;
  const planRows = toNumber(node['Plan Rows']) ?? 0;
  const actualRows = toNumber(node['Actual Rows']) ?? 0;
  const timeShare = actualTime != null && rootActualTime && rootActualTime > 0
    ? actualTime / rootActualTime
    : 0;
  const skewRatio = planRows > 0 && actualRows > 0 ? actualRows / planRows : 0;
  const accessPathType = getAccessPathType(node);

  if (timeShare >= 0.35) {
    return {
      label: 'Bottleneck',
      reason: `Accounts for ${(timeShare * 100).toFixed(0)}% of ${timeShareSource} time`,
      tone: 'danger',
    };
  }

  if (accessPathType === 'sequential' && scannedRows >= 1_000) {
    return {
      label: 'Bottleneck',
      reason: `Sequential scan touches ${formatRows(scannedRows)} rows`,
      tone: 'warning',
    };
  }

  if (totalCost >= 1_000 && scannedRows >= 1_000) {
    return {
      label: 'Hot Path',
      reason: `High estimated cost (${formatPlannerEstimatedCost(totalCost)})`,
      tone: 'warning',
    };
  }

  if (skewRatio >= 5) {
    return {
      label: 'Skew',
      reason: `Actual rows are ${skewRatio.toFixed(1)}x estimate`,
      tone: 'warning',
    };
  }

  return null;
}

function collectNodes(root: PgPlanNode): PgPlanNode[] {
  const nodes: PgPlanNode[] = [];
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.shift();

    if (!current) {
      continue;
    }

    nodes.push(current);
    queue.push(...getChildren(current));
  }

  return nodes;
}

function getBadgeClasses(tone: PlanBadgeTone): string {
  switch (tone) {
    case 'danger':
      return 'border-error/30 bg-error/10 text-error';
    case 'warning':
      return 'border-tertiary/30 bg-tertiary/10 text-tertiary';
    case 'success':
      return 'border-secondary/30 bg-secondary/10 text-secondary';
    default:
      return 'border-outline-variant/20 bg-surface-container-low text-on-surface-variant';
  }
}

function MetricPill({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: PlanBadgeTone;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium',
        getBadgeClasses(tone),
      )}
    >
      <span className="text-outline">{label}</span>
      <span className="font-mono text-current">{value}</span>
    </span>
  );
}

function PlanNodeCard({
  node,
  depth,
  rootActualTime,
  rootTotalCost,
  compact = false,
  timeShareSource = 'EXPLAIN ANALYZE',
}: {
  node: PgPlanNode;
  depth: number;
  rootActualTime?: number;
  rootTotalCost?: number;
  compact?: boolean;
  timeShareSource?: string;
}) {
  const children = getChildren(node);
  const nodeType = getNodeType(node);
  const relationLabel = getRelationLabel(node);
  const scannedRows = getScannedRows(node);
  const actualTime = getActualTime(node);
  const totalCost = getTotalCost(node);
  const accessPathType = getAccessPathType(node);
  const bufferStats = getBufferStats(node);
  const highlight = getNodeHighlight(node, rootActualTime, timeShareSource);
  const conditions = [node['Index Cond'], node.Filter, node['Hash Cond'], node['Merge Cond'], node['Recheck Cond']]
    .filter((condition): condition is string => typeof condition === 'string' && condition.length > 0);
  const timeShare = actualTime != null && rootActualTime && rootActualTime > 0
    ? Math.min(100, (actualTime / rootActualTime) * 100)
    : undefined;
  const costShare = totalCost != null && rootTotalCost && rootTotalCost > 0
    ? Math.min(100, (totalCost / rootTotalCost) * 100)
    : undefined;

  return (
    <div className={cn('space-y-3', compact && 'space-y-2')}>
      <div
        className={cn(
          'border border-outline-variant/10 bg-surface-container-lowest shadow-sm',
          compact ? 'rounded-xl p-3' : 'rounded-2xl p-4',
        )}
      >
        <div className={cn('flex flex-col', compact ? 'gap-2' : 'gap-3')}>
          <div className={cn('flex flex-col', compact ? 'gap-2' : 'gap-3 lg:flex-row lg:items-start lg:justify-between')}>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('font-semibold text-on-surface', compact ? 'text-xs' : 'text-sm')}>
                  {nodeType}
                </span>
                {node['Parent Relationship'] && (
                  <span className={cn('rounded-full bg-surface-container text-on-surface-variant', compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]')}>
                    {node['Parent Relationship']}
                  </span>
                )}
                {node['Join Type'] && (
                  <span className={cn('rounded-full bg-surface-container text-on-surface-variant', compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]')}>
                    {node['Join Type']} join
                  </span>
                )}
              </div>
              {relationLabel && (
                <p className={cn('mt-1 truncate font-mono text-on-surface-variant', compact ? 'text-xs' : 'text-sm')}>
                  {relationLabel}
                </p>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {totalCost != null && (
                <MetricPill label="Cost" value={formatPlannerEstimatedCost(totalCost)} />
              )}
              {scannedRows != null && (
                <MetricPill
                  label={actualTime != null ? 'Scanned rows' : 'Plan rows'}
                  value={formatRows(scannedRows)}
                />
              )}
              {actualTime != null && (
                <MetricPill label="Time" value={formatDuration(actualTime)} tone="warning" />
              )}
              {accessPathType && (
                <MetricPill
                  label="Access"
                  value={accessPathType === 'index' ? 'Index scan' : 'Seq scan'}
                  tone={accessPathType === 'index' ? 'success' : 'warning'}
                />
              )}
              {highlight && (
                <MetricPill label={highlight.label} value={highlight.reason} tone={highlight.tone} />
              )}
            </div>
          </div>

          {!compact && (timeShare != null || costShare != null) && (
            <div className="grid gap-2 md:grid-cols-2">
              {timeShare != null && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-on-surface-variant">
                    <span>Plan time share</span>
                    <span className="font-mono">{timeShare.toFixed(0)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-container">
                    <div className="h-full rounded-full bg-tertiary" style={{ width: `${timeShare}%` }} />
                  </div>
                </div>
              )}
              {costShare != null && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-on-surface-variant">
                    <span>Estimated cost share</span>
                    <span className="font-mono">{costShare.toFixed(0)}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-container">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${costShare}%` }} />
                  </div>
                </div>
              )}
            </div>
          )}

          {(bufferStats.hits != null || bufferStats.reads != null || conditions.length > 0) && (
            <div className={cn('border-t border-outline-variant/10 text-xs text-on-surface-variant', compact ? 'space-y-1.5 pt-2' : 'space-y-2 pt-3')}>
              {(bufferStats.hits != null || bufferStats.reads != null) && (
                <div className="flex flex-wrap gap-3">
                  {bufferStats.hits != null && (
                    <span>
                      Buffer hits: <span className="font-mono text-on-surface">{formatRows(bufferStats.hits)}</span>
                    </span>
                  )}
                  {bufferStats.reads != null && (
                    <span>
                      Buffer reads: <span className="font-mono text-on-surface">{formatRows(bufferStats.reads)}</span>
                    </span>
                  )}
                </div>
              )}
              {conditions.length > 0 && (
                <div className="space-y-1">
                  {(compact ? conditions.slice(0, 1) : conditions).map((condition) => (
                    <p key={condition} className="font-mono text-[11px] text-on-surface-variant">
                      {condition}
                    </p>
                  ))}
                  {compact && conditions.length > 1 && (
                    <p className="text-[10px] text-outline">
                      +{conditions.length - 1} condition(s)
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {children.length > 0 && (
        <div className={cn('space-y-3 border-l border-dashed border-outline-variant/20', compact ? 'pl-3' : 'pl-4')}>
          {children.map((child, index) => (
            <PlanNodeCard
              key={`${nodeType}-${relationLabel ?? 'node'}-${depth + 1}-${index}`}
              node={child}
              depth={depth + 1}
              rootActualTime={rootActualTime}
              rootTotalCost={rootTotalCost}
              compact={compact}
              timeShareSource={timeShareSource}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function ExecutionPlanTree({
  executionPlan,
  queryDurationMs,
  compact = false,
}: {
  executionPlan: QueryExecutionPlan;
  queryDurationMs?: number;
  compact?: boolean;
}) {
  const rootNode = getPlanRoot(executionPlan.plan);
  const sqlServerPlan = isSqlServerWrappedPlan(executionPlan.plan);
  const operatorTimeLabel = sqlServerPlan ? 'SQL Server operator time' : 'Postgres executor time';
  const timeShareSource = sqlServerPlan ? 'SQL Server operator' : 'EXPLAIN ANALYZE';

  if (!rootNode) {
    return (
      <pre className="overflow-auto rounded-2xl bg-surface-container-lowest p-4 text-xs font-mono text-on-surface-variant">
        {JSON.stringify(executionPlan.plan, null, 2)}
      </pre>
    );
  }

  const nodes = collectNodes(rootNode);
  const rootActualTime = getActualTime(rootNode) ?? executionPlan.actualTime;
  const rootTotalCost = getTotalCost(rootNode) ?? executionPlan.totalCost;
  const indexScans = nodes.filter((node) => getAccessPathType(node) === 'index').length;
  const sequentialScans = nodes.filter((node) => getAccessPathType(node) === 'sequential').length;
  const bottleneckCandidates = nodes.length > 1 ? nodes.slice(1) : nodes;
  const bottlenecks = bottleneckCandidates
    .map((node) => ({
      node,
      highlight: getNodeHighlight(node, rootActualTime, timeShareSource),
    }))
    .filter(
      (
        item,
      ): item is {
        node: PgPlanNode;
        highlight: NonNullable<ReturnType<typeof getNodeHighlight>>;
      } => item.highlight != null,
    )
    .sort((left, right) => {
      const timeDiff = (getActualTime(right.node) ?? 0) - (getActualTime(left.node) ?? 0);

      if (timeDiff !== 0) {
        return timeDiff;
      }

      return (getTotalCost(right.node) ?? 0) - (getTotalCost(left.node) ?? 0);
    })
    .slice(0, 3);
  const scannedRows = getScannedRows(rootNode);

  return (
    <div className={cn('space-y-4', compact && 'space-y-3')}>
      <div className={cn('grid gap-2 md:grid-cols-2 xl:grid-cols-5', compact && 'xl:grid-cols-5')}>
        <div className={cn('border border-outline-variant/10 bg-surface-container-low', compact ? 'rounded-xl p-2.5' : 'rounded-2xl p-4')}>
          <p className={cn('uppercase tracking-wide text-outline', compact ? 'text-[10px]' : 'text-xs')}>Plan mode</p>
          <p className={cn('font-semibold text-on-surface', compact ? 'mt-1 text-xs' : 'mt-2 text-sm')}>
            {executionPlan.mode === 'explain' ? 'EXPLAIN' : 'EXPLAIN ANALYZE'}
          </p>
        </div>
        <div className={cn('border border-outline-variant/10 bg-surface-container-low', compact ? 'rounded-xl p-2.5' : 'rounded-2xl p-4')}>
          <p className={cn('uppercase tracking-wide text-outline', compact ? 'text-[10px]' : 'text-xs')}>Estimated cost</p>
          <p className={cn('font-semibold text-on-surface font-mono', compact ? 'mt-1 text-xs' : 'mt-2 text-sm')}>
            {rootTotalCost != null ? formatPlannerEstimatedCost(rootTotalCost) : '—'}
          </p>
        </div>
        <div className={cn('border border-outline-variant/10 bg-surface-container-low', compact ? 'rounded-xl p-2.5' : 'rounded-2xl p-4')}>
          <p className={cn('uppercase tracking-wide text-outline', compact ? 'text-[10px]' : 'text-xs')}>
            {rootActualTime != null ? operatorTimeLabel : 'Planned rows'}
          </p>
          <p className={cn('font-semibold text-on-surface font-mono', compact ? 'mt-1 text-xs' : 'mt-2 text-sm')}>
            {rootActualTime != null
              ? formatDuration(rootActualTime)
              : scannedRows != null
                ? formatRows(scannedRows)
                : '—'}
          </p>
        </div>
        <div className={cn('border border-outline-variant/10 bg-surface-container-low', compact ? 'rounded-xl p-2.5' : 'rounded-2xl p-4')}>
          <p className={cn('uppercase tracking-wide text-outline', compact ? 'text-[10px]' : 'text-xs')}>End-to-end query time</p>
          <p className={cn('font-semibold text-on-surface font-mono', compact ? 'mt-1 text-xs' : 'mt-2 text-sm')}>
            {queryDurationMs != null ? formatDuration(queryDurationMs) : '—'}
          </p>
        </div>
        <div className={cn('border border-outline-variant/10 bg-surface-container-low', compact ? 'rounded-xl p-2.5' : 'rounded-2xl p-4')}>
          <p className={cn('uppercase tracking-wide text-outline', compact ? 'text-[10px]' : 'text-xs')}>Access path</p>
          <p className={cn('font-semibold text-on-surface', compact ? 'mt-1 text-xs' : 'mt-2 text-sm')}>
            <span className="font-mono text-secondary">{indexScans}</span> index scan
            {' / '}
            <span className="font-mono text-tertiary">{sequentialScans}</span> seq scan
          </p>
        </div>
      </div>

      {!compact && (
      <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-lowest p-4 text-xs text-on-surface-variant">
        {sqlServerPlan ? (
          <>
            <p>
              <span className="font-semibold text-on-surface">SQL Server operator time</span>
              {' '}comes from <span className="font-mono">STATISTICS XML</span> / runtime counters when available (estimated plan only shows costs/rows from{' '}
              <span className="font-mono">SHOWPLAN_XML</span>).
            </p>
            <p className="mt-2">
              <span className="font-semibold text-on-surface">End-to-end query time</span>
              {' '}includes the app roundtrip, result transfer, and response shaping.
            </p>
            <p className="mt-2">
              <span className="font-semibold text-on-surface">Access path</span>
              {' '}counts operators whose name includes index scan versus table/heap-style scans.
            </p>
          </>
        ) : (
          <>
            <p>
              <span className="font-semibold text-on-surface">Postgres executor time</span>
              {' '}comes from <span className="font-mono">EXPLAIN ANALYZE</span> and measures work inside Postgres.
            </p>
            <p className="mt-2">
              <span className="font-semibold text-on-surface">End-to-end query time</span>
              {' '}includes the app roundtrip, result transfer, and response shaping.
            </p>
            <p className="mt-2">
              <span className="font-semibold text-on-surface">Access path</span>
              {' '}counts index scan nodes versus sequential scan nodes. It is not a cache hit/miss metric.
            </p>
          </>
        )}
      </div>
      )}

      {bottlenecks.length > 0 && (
        <div className={cn('border border-tertiary/20 bg-tertiary/5', compact ? 'rounded-xl p-3' : 'rounded-2xl p-4')}>
          <p className={cn('uppercase tracking-wide text-tertiary', compact ? 'text-[10px]' : 'text-xs')}>
            Potential bottlenecks
          </p>
          <div className={cn('space-y-2', compact ? 'mt-2' : 'mt-3')}>
            {bottlenecks.slice(0, compact ? 2 : 3).map(({ node, highlight }, index) => (
              <div
                key={`${getNodeType(node)}-${index}`}
                className={cn('flex flex-wrap items-center gap-2', compact ? 'text-xs' : 'text-sm')}
              >
                <span className="font-semibold text-on-surface">{getNodeType(node)}</span>
                {getRelationLabel(node) && (
                  <span className="font-mono text-on-surface-variant">{getRelationLabel(node)}</span>
                )}
                <span
                  className={cn(
                    'rounded-full border',
                    compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-[11px]',
                    getBadgeClasses(highlight.tone),
                  )}
                >
                  {highlight.reason}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <PlanNodeCard
        node={rootNode}
        depth={0}
        rootActualTime={rootActualTime}
        rootTotalCost={rootTotalCost}
        compact={compact}
        timeShareSource={timeShareSource}
      />
    </div>
  );
}
