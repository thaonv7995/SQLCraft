import type { QueryExecutionPlan } from '@/lib/api';
import { isSqlServerWrappedPlan, tryMssqlPlanToPgShapedRoot } from '@/lib/mssql-plan-adapter';
import { tryMysqlJsonToPgRoot } from '@/lib/mysql-explain-adapter';
import { cn, formatDuration, formatPlannerEstimatedCost, formatRows } from '@/lib/utils';
import { useState } from 'react';

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

type VisualPlanNode = {
  id: string;
  node: PgPlanNode;
  parentId: string | null;
  depth: number;
  x: number;
  y: number;
};

type DragState = {
  id: string;
  pointerId: number;
  startPointerX: number;
  startPointerY: number;
  startNodeX: number;
  startNodeY: number;
};

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

function getNodeSubject(node: PgPlanNode): { primary: string | null; secondary: string | null } {
  const alias = node.Alias;
  const relation = node['Relation Name'];
  const indexName = node['Index Name'];

  if (alias && relation && alias !== relation) {
    return {
      primary: `${alias} · ${relation}`,
      secondary: indexName ? `via ${indexName}` : null,
    };
  }

  if (relation) {
    return {
      primary: relation,
      secondary: indexName ? `via ${indexName}` : null,
    };
  }

  if (indexName) {
    return { primary: indexName, secondary: null };
  }

  return { primary: null, secondary: null };
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

  if (actualTime != null && accessPathType === 'sequential' && scannedRows >= 1_000) {
    return {
      label: 'Bottleneck',
      reason: `Sequential scan touches ${formatRows(scannedRows)} rows`,
      tone: 'warning',
    };
  }

  if (actualTime == null && totalCost >= 1_000 && scannedRows >= 10_000) {
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

function layoutVisualPlan(root: PgPlanNode): { nodes: VisualPlanNode[]; width: number; height: number } {
  const nodeWidth = 252;
  const colGap = 36;
  const rowGap = 82;
  const paddingX = 42;
  const paddingY = 82;
  const maxColumns = 3;
  const nodesByDepth = new Map<number, VisualPlanNode[]>();
  let maxDepth = 0;

  function collect(node: PgPlanNode, parentId: string | null, depth: number, path: string): void {
    maxDepth = Math.max(maxDepth, depth);

    const entry: VisualPlanNode = {
      id: path,
      node,
      parentId,
      depth,
      x: 0,
      y: 0,
    };
    const bucket = nodesByDepth.get(depth) ?? [];
    bucket.push(entry);
    nodesByDepth.set(depth, bucket);

    getChildren(node).forEach((child, index) => collect(child, path, depth + 1, `${path}.${index}`));
  }

  collect(root, null, 0, '0');

  const maxLevelCount = Math.max(1, ...Array.from(nodesByDepth.values()).map((level) => level.length));
  const columns = Math.min(maxColumns, maxLevelCount);
  const width = paddingX * 2 + columns * nodeWidth + (columns - 1) * colGap;
  let height = paddingY;
  const positioned: VisualPlanNode[] = [];

  for (let depth = 0; depth <= maxDepth; depth += 1) {
    const level = nodesByDepth.get(depth) ?? [];
    const rows = Math.max(1, Math.ceil(level.length / maxColumns));
    const levelHeight = rows * 116 + (rows - 1) * 18;
    const y = height + levelHeight / 2;

    level.forEach((entry, index) => {
      const row = Math.floor(index / maxColumns);
      const column = index % maxColumns;
      const itemsInRow = Math.min(maxColumns, level.length - row * maxColumns);
      const rowWidth = itemsInRow * nodeWidth + (itemsInRow - 1) * colGap;
      const startX = (width - rowWidth) / 2 + nodeWidth / 2;

      entry.x = startX + column * (nodeWidth + colGap);
      entry.y = y + row * (116 + 18);
      positioned.push(entry);
    });

    height += levelHeight + rowGap;
  }

  return {
    nodes: positioned,
    width: Math.max(640, width),
    height: height - rowGap + paddingY,
  };
}

function getConnectorPath(parent: VisualPlanNode, child: VisualPlanNode): string {
  const parentBottom = parent.y + 58;
  const childTop = child.y - 58;
  const midY = parentBottom + Math.max(22, Math.min(52, (childTop - parentBottom) * 0.45));

  return `M ${parent.x} ${parentBottom} C ${parent.x} ${midY}, ${child.x} ${midY}, ${child.x} ${childTop}`;
}

function getVisualTone(node: PgPlanNode, rootActualTime?: number, timeShareSource?: string): PlanBadgeTone {
  const highlight = getNodeHighlight(node, rootActualTime, timeShareSource);

  if (highlight) {
    return highlight.tone;
  }

  const accessPathType = getAccessPathType(node);

  if (accessPathType === 'index') {
    return 'success';
  }

  if (accessPathType === 'sequential') {
    return 'warning';
  }

  return 'neutral';
}

function getVisualNodeClasses(tone: PlanBadgeTone, selected: boolean): string {
  const selectedClass = selected ? 'border-primary/75 bg-surface-container-low shadow-[0_0_0_1px_rgba(232,232,232,0.28)]' : '';

  switch (tone) {
    case 'danger':
      return cn('border-error/55 bg-error/10 shadow-[0_0_24px_rgba(239,68,68,0.16)]', selectedClass);
    case 'warning':
      return cn('border-tertiary/55 bg-tertiary/10 shadow-[0_0_22px_rgba(245,158,11,0.14)]', selectedClass);
    case 'success':
      return cn('border-secondary/45 bg-secondary/10 shadow-[0_0_20px_rgba(34,197,94,0.12)]', selectedClass);
    default:
      return cn('border-outline-variant/20 bg-surface-container-lowest', selectedClass);
  }
}

function getNodeKindLabel(node: PgPlanNode): string {
  const nodeType = getNodeType(node).toLowerCase();

  if (nodeType.includes('join') || nodeType.includes('nested loop')) return 'Join';
  if (nodeType.includes('index')) return 'Index';
  if (nodeType.includes('seq scan') || nodeType.includes('table scan')) return 'Scan';
  if (nodeType.includes('sort')) return 'Sort';
  if (nodeType.includes('aggregate')) return 'Agg';
  if (nodeType.includes('filter')) return 'Filter';

  return 'Op';
}

function getVisualEdgeLabel(parent: PgPlanNode, child: PgPlanNode, childIndex: number): string {
  const parentType = getNodeType(parent).toLowerCase();
  const childAccess = getAccessPathType(child);

  if (childIndex === 0) {
    return parentType.includes('join') || parentType.includes('nested loop') ? 'outer' : 'input';
  }

  if (childAccess === 'index') {
    return 'lookup';
  }

  return parentType.includes('join') || parentType.includes('nested loop') ? 'inner' : `input ${childIndex + 1}`;
}

function getChildIndexFromId(id: string): number {
  const index = Number(id.split('.').at(-1));
  return Number.isFinite(index) ? index : 0;
}

function getToneFillClass(tone: PlanBadgeTone): string {
  switch (tone) {
    case 'danger':
      return 'bg-error';
    case 'warning':
      return 'bg-tertiary';
    case 'success':
      return 'bg-secondary';
    default:
      return 'bg-outline';
  }
}

function clampPercent(value: number): number {
  return Math.max(4, Math.min(100, value));
}

function getNodeMetricPercent(node: PgPlanNode, maxTime: number, maxCost: number): number {
  const actualTime = getActualTime(node);
  const totalCost = getTotalCost(node);

  if (actualTime != null && maxTime > 0) {
    return clampPercent((actualTime / maxTime) * 100);
  }

  if (totalCost != null && maxCost > 0) {
    return clampPercent((totalCost / maxCost) * 100);
  }

  return 4;
}

function getNodeMetricLabel(node: PgPlanNode): string {
  const actualTime = getActualTime(node);
  const totalCost = getTotalCost(node);

  if (actualTime != null) {
    return `Time ${formatDuration(actualTime)}`;
  }

  if (totalCost != null) {
    return `Cost ${formatPlannerEstimatedCost(totalCost)}`;
  }

  return 'No metric';
}

function getSelectedPathIds(nodeById: Map<string, VisualPlanNode>, selected: VisualPlanNode): Set<string> {
  const ids = new Set<string>();
  let current: VisualPlanNode | undefined = selected;

  while (current) {
    ids.add(current.id);
    current = current.parentId ? nodeById.get(current.parentId) : undefined;
  }

  return ids;
}

function getConditionEntries(node: PgPlanNode): Array<{ label: string; value: string }> {
  return [
    ['Index Cond', node['Index Cond']],
    ['Filter', node.Filter],
    ['Hash Cond', node['Hash Cond']],
    ['Merge Cond', node['Merge Cond']],
    ['Recheck Cond', node['Recheck Cond']],
  ]
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0)
    .map(([label, value]) => ({ label, value }));
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

function SummaryPill({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: PlanBadgeTone;
}) {
  return (
    <div className={cn('inline-flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1.5', getBadgeClasses(tone))}>
      <span className="text-[10px] uppercase text-outline">{label}</span>
      <span className="truncate font-mono text-xs font-semibold text-on-surface">{value}</span>
    </div>
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

export function ExecutionPlanGraph({
  executionPlan,
  queryDurationMs,
}: {
  executionPlan: QueryExecutionPlan;
  queryDurationMs?: number;
}) {
  const rootNode = getPlanRoot(executionPlan.plan);
  const sqlServerPlan = isSqlServerWrappedPlan(executionPlan.plan);
  const timeShareSource = sqlServerPlan ? 'SQL Server operator' : 'EXPLAIN ANALYZE';
  const operatorTimeLabel = sqlServerPlan ? 'Operator time' : 'Executor time';
  const rootActualTime = rootNode ? getActualTime(rootNode) ?? executionPlan.actualTime : executionPlan.actualTime;
  const rootTotalCost = rootNode ? getTotalCost(rootNode) ?? executionPlan.totalCost : executionPlan.totalCost;
  const layout = rootNode ? layoutVisualPlan(rootNode) : null;
  const [selectedId, setSelectedId] = useState('0');
  const [manualPositions, setManualPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [dragState, setDragState] = useState<DragState | null>(null);

  if (!rootNode || !layout) {
    return (
      <pre className="overflow-auto rounded-2xl bg-surface-container-lowest p-4 text-xs font-mono text-on-surface-variant">
        {JSON.stringify(executionPlan.plan, null, 2)}
      </pre>
    );
  }

  const displayNodes = layout.nodes.map((entry) => {
    const manual = manualPositions[entry.id];
    return manual ? { ...entry, x: manual.x, y: manual.y } : entry;
  });
  const layoutNodeCount = layout.nodes.length;
  const nodeById = new Map(displayNodes.map((entry) => [entry.id, entry]));
  const selected = nodeById.get(selectedId) ?? nodeById.get('0') ?? layout.nodes[0];
  const selectedNode = selected.node;
  const selectedPathIds = getSelectedPathIds(nodeById, selected);
  const selectedHighlight =
    selected.parentId != null || layoutNodeCount === 1
      ? getNodeHighlight(selectedNode, rootActualTime, timeShareSource)
      : null;
  const selectedRows = getScannedRows(selectedNode);
  const selectedTime = getActualTime(selectedNode);
  const selectedCost = getTotalCost(selectedNode);
  const selectedRelation = getRelationLabel(selectedNode);
  const selectedConditions = getConditionEntries(selectedNode);
  const selectedBufferStats = getBufferStats(selectedNode);
  const nodes = displayNodes.map((entry) => entry.node);
  const maxNodeTime = Math.max(0, ...nodes.map((node) => getActualTime(node) ?? 0));
  const maxNodeCost = Math.max(0, ...nodes.map((node) => getTotalCost(node) ?? 0));
  const indexScans = nodes.filter((node) => getAccessPathType(node) === 'index').length;
  const sequentialScans = nodes.filter((node) => getAccessPathType(node) === 'sequential').length;
  const hasManualPositions = Object.keys(manualPositions).length > 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <SummaryPill label="Mode" value={executionPlan.mode === 'explain' ? 'EXPLAIN' : 'ANALYZE'} />
        <SummaryPill label="Cost" value={rootTotalCost != null ? formatPlannerEstimatedCost(rootTotalCost) : '—'} />
        <SummaryPill label="Time" value={rootActualTime != null ? formatDuration(rootActualTime) : '—'} />
        <SummaryPill label="Query" value={queryDurationMs != null ? formatDuration(queryDurationMs) : '—'} />
        <SummaryPill label="Nodes" value={String(nodes.length)} />
        <SummaryPill label="Access" value={`${indexScans} idx / ${sequentialScans} seq`} />
        <button
          type="button"
          onClick={() => setManualPositions({})}
          className="rounded-lg border border-outline-variant/20 bg-surface-container-low px-2.5 py-1.5 text-[11px] font-medium text-on-surface-variant transition hover:border-primary/40 hover:text-on-surface"
        >
          Auto format
        </button>
        {hasManualPositions && <span className="text-[11px] text-outline">custom layout</span>}
      </div>

      {false ? (
        <div className="rounded-xl border border-outline-variant/10 bg-surface-container-lowest p-4">
          <div className="mx-auto max-w-[360px]">
            {displayNodes
              .filter((entry) => entry.parentId == null)
              .map((entry) => {
                const node = entry.node;
                const tone = entry.id === selected.id ? 'neutral' : 'neutral';
                const subject = getNodeSubject(node);
                const totalCost = getTotalCost(node);
                const scannedRows = getScannedRows(node);
                const metricPercent = getNodeMetricPercent(node, maxNodeTime, maxNodeCost);

                return (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => setSelectedId(entry.id)}
                    className={cn(
                      'w-full rounded-lg border p-3 text-left transition hover:border-primary/45',
                      entry.id === selected.id ? 'border-primary/70 bg-surface-container-low' : 'border-outline-variant/20 bg-surface-container-lowest',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className={cn('h-2 w-2 shrink-0 rounded-full', getToneFillClass(tone))} />
                          <p className="truncate text-sm font-semibold text-on-surface">{getNodeType(node)}</p>
                        </div>
                        {subject.primary && (
                          <p className="mt-1 truncate font-mono text-[11px] text-on-surface-variant">{subject.primary}</p>
                        )}
                      </div>
                      <span className={cn('shrink-0 rounded-md border px-1.5 py-0.5 text-[10px]', getBadgeClasses(tone))}>
                        {getNodeKindLabel(node)}
                      </span>
                    </div>
                    <div className="mt-2 h-1 overflow-hidden rounded-full bg-surface-container-high">
                      <div className={cn('h-full rounded-full', getToneFillClass(tone))} style={{ width: `${metricPercent}%` }} />
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-on-surface-variant">
                      <span>
                        <span className="block text-outline">Subtree cost</span>
                        <span className="block font-mono text-on-surface">{totalCost != null ? formatPlannerEstimatedCost(totalCost) : '—'}</span>
                      </span>
                      <span className="text-right">
                        <span className="block text-outline">Rows</span>
                        <span className="block font-mono text-on-surface">{scannedRows != null ? formatRows(scannedRows) : '—'}</span>
                      </span>
                    </div>
                  </button>
                );
              })}
          </div>

          <div className="relative mx-auto my-3 h-12 max-w-[820px]" aria-hidden="true">
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 820 48" preserveAspectRatio="none">
              {displayNodes
                .filter((entry) => entry.parentId != null)
                .map((entry) => {
                  const childIndex = getChildIndexFromId(entry.id);
                  const childCount = Math.max(1, displayNodes.filter((candidate) => candidate.parentId != null).length);
                  const startX = 410;
                  const endX = childCount === 1 ? 410 : 70 + (childIndex / Math.max(1, childCount - 1)) * 680;
                  const selectedEdge = selectedPathIds.has(entry.id);

                  return (
                    <path
                      key={`overview-${entry.id}`}
                      d={`M ${startX} 0 C ${startX} 22, ${endX} 20, ${endX} 48`}
                      fill="none"
                      stroke={selectedEdge ? 'rgb(232 232 232 / 0.72)' : 'rgb(168 176 188 / 0.28)'}
                      strokeWidth={selectedEdge ? 2.25 : 1.4}
                      strokeLinecap="round"
                    />
                  );
                })}
            </svg>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {displayNodes.map((entry) => {
            if (entry.parentId == null) return null;
            const node = entry.node;
            const parent = entry.parentId ? nodeById.get(entry.parentId) : null;
            const tone =
              entry.parentId != null || layoutNodeCount === 1
                ? getVisualTone(node, rootActualTime, timeShareSource)
                : 'neutral';
            const subject = getNodeSubject(node);
            const actualTime = getActualTime(node);
            const totalCost = getTotalCost(node);
            const scannedRows = getScannedRows(node);
            const metricPercent = getNodeMetricPercent(node, maxNodeTime, maxNodeCost);
            const nodeHighlight =
              entry.parentId != null || layoutNodeCount === 1
                ? getNodeHighlight(node, rootActualTime, timeShareSource)
                : null;
            const role = parent
              ? getVisualEdgeLabel(parent.node, node, getChildIndexFromId(entry.id))
              : 'root';

            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setSelectedId(entry.id)}
                className={cn(
                  'min-h-[132px] rounded-lg border p-3 text-left transition hover:border-primary/45',
                  entry.id === selected.id
                    ? 'border-primary/70 bg-surface-container-low'
                    : 'border-outline-variant/10 bg-surface-container-lowest',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', getToneFillClass(tone))} />
                      <span className="font-mono text-[10px] uppercase text-on-surface-variant">{role}</span>
                    </div>
                    <span className="truncate text-sm font-semibold text-on-surface">{getNodeType(node)}</span>
                    {(subject.primary || subject.secondary) && (
                      <p className="mt-1 truncate font-mono text-[11px] text-on-surface-variant">
                        {[subject.primary, subject.secondary].filter(Boolean).join(' ')}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={cn('shrink-0 rounded-md border px-1.5 py-0.5 text-[10px]', getBadgeClasses(tone))}>
                      {getNodeKindLabel(node)}
                    </span>
                    {nodeHighlight && (
                      <span className={cn('shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]', getBadgeClasses(nodeHighlight.tone))}>
                        {nodeHighlight.label}
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-container-high">
                  <div className={cn('h-full rounded-full', getToneFillClass(tone))} style={{ width: `${metricPercent}%` }} />
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 text-[11px] text-on-surface-variant">
                  <span>
                    <span className="block text-outline">{actualTime != null ? 'Time' : 'Subtree cost'}</span>
                    <span className="block font-mono text-on-surface">
                      {actualTime != null ? formatDuration(actualTime) : formatPlannerEstimatedCost(totalCost ?? 0)}
                    </span>
                  </span>
                  <span>
                    <span className="block text-outline">Rows</span>
                    <span className="block font-mono text-on-surface">{scannedRows != null ? formatRows(scannedRows) : '—'}</span>
                  </span>
                </div>
              </button>
            );
          })}
          </div>
        </div>
      ) : (
      <div className="overflow-auto rounded-xl border border-outline-variant/10 bg-surface-container-lowest">
        <div
          className="relative"
          style={{
            width: `${layout.width}px`,
            height: `${layout.height}px`,
            minWidth: '100%',
          }}
        >
          <svg
            className="pointer-events-none absolute inset-0"
            width={layout.width}
            height={layout.height}
            role="img"
            aria-label="Execution plan graph connectors"
          >
            {displayNodes
              .filter((entry) => entry.parentId != null)
              .map((entry) => {
                const parent = entry.parentId ? nodeById.get(entry.parentId) : null;

                if (!parent) {
                  return null;
                }

                const isSelectedEdge = selectedPathIds.has(entry.id) && selectedPathIds.has(parent.id);
                const stroke = isSelectedEdge ? 'rgb(232 232 232 / 0.82)' : 'rgb(168 176 188 / 0.32)';
                const strokeWidth = isSelectedEdge ? 2.5 : 1.5;
                const edgeLabel = getVisualEdgeLabel(parent.node, entry.node, getChildIndexFromId(entry.id));
                const labelX = (parent.x + entry.x) / 2;
                const labelY = parent.y + 82;

                return (
                  <g key={`${parent.id}-${entry.id}`}>
                    <path
                      d={getConnectorPath(parent, entry)}
                      fill="none"
                      stroke={stroke}
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <circle cx={entry.x} cy={entry.y - 58} r={3.5} fill={stroke} />
                    <text
                      x={labelX}
                      y={labelY}
                      fill="rgb(168 176 188 / 0.72)"
                      fontSize="10"
                      fontFamily="var(--font-jetbrains-mono), monospace"
                      textAnchor="middle"
                    >
                      {edgeLabel}
                    </text>
                  </g>
                );
              })}
          </svg>

          {displayNodes.map((entry) => {
            const node = entry.node;
            const tone =
              entry.parentId != null || layoutNodeCount === 1
                ? getVisualTone(node, rootActualTime, timeShareSource)
                : 'neutral';
            const subject = getNodeSubject(node);
            const actualTime = getActualTime(node);
            const totalCost = getTotalCost(node);
              const scannedRows = getScannedRows(node);
              const isSelected = entry.id === selected.id;
              const metricPercent = getNodeMetricPercent(node, maxNodeTime, maxNodeCost);
              const nodeHighlight =
                entry.parentId != null || layoutNodeCount === 1
                  ? getNodeHighlight(node, rootActualTime, timeShareSource)
                  : null;
              const nodeKind = getNodeKindLabel(node);

              return (
                <button
                key={entry.id}
                type="button"
                onClick={() => setSelectedId(entry.id)}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  setSelectedId(entry.id);
                  setDragState({
                    id: entry.id,
                    pointerId: event.pointerId,
                    startPointerX: event.clientX,
                    startPointerY: event.clientY,
                    startNodeX: entry.x,
                    startNodeY: entry.y,
                  });
                }}
                onPointerMove={(event) => {
                  if (!dragState || dragState.id !== entry.id || dragState.pointerId !== event.pointerId) return;
                  const nextX = Math.max(126, Math.min(layout.width - 126, dragState.startNodeX + event.clientX - dragState.startPointerX));
                  const nextY = Math.max(58, Math.min(layout.height - 58, dragState.startNodeY + event.clientY - dragState.startPointerY));
                  setManualPositions((current) => ({
                    ...current,
                    [entry.id]: { x: nextX, y: nextY },
                  }));
                }}
                onPointerUp={(event) => {
                  if (dragState?.pointerId === event.pointerId) {
                    setDragState(null);
                  }
                }}
                onPointerCancel={(event) => {
                  if (dragState?.pointerId === event.pointerId) {
                    setDragState(null);
                  }
                }}
                className={cn(
                  'absolute flex min-h-[106px] touch-none cursor-grab flex-col items-start gap-2 rounded-lg border p-3 text-left shadow-sm transition hover:border-primary/55 active:cursor-grabbing focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/80',
                  getVisualNodeClasses(tone, isSelected),
                )}
                style={{
                  left: entry.x,
                  top: entry.y,
                  width: 252,
                  transform: 'translate(-50%, -50%)',
                }}
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', getToneFillClass(tone))} />
                      <p className="truncate text-sm font-semibold text-on-surface">{getNodeType(node)}</p>
                    </div>
                    {subject.primary && (
                      <p className="mt-1 truncate font-mono text-[11px] text-on-surface">
                        {subject.primary}
                      </p>
                    )}
                    {subject.secondary && (
                      <p className="mt-0.5 truncate font-mono text-[10px] text-on-surface-variant">
                        {subject.secondary}
                      </p>
                    )}
                  </div>
                  <span className={cn('shrink-0 rounded-md border px-1.5 py-0.5 text-[10px]', getBadgeClasses(tone))}>
                    {nodeKind}
                  </span>
                </div>

                <div className="h-1 w-full overflow-hidden rounded-full bg-surface-container-high">
                  <div
                    className={cn('h-full rounded-full', getToneFillClass(tone))}
                    style={{ width: `${metricPercent}%` }}
                  />
                </div>

                <div className="grid w-full grid-cols-2 gap-2 text-[10px] text-on-surface-variant">
                  <span className="min-w-0">
                    <span className="block text-outline">{actualTime != null ? 'Time' : 'Subtree cost'}</span>
                    <span className="block truncate font-mono text-on-surface">
                      {actualTime != null ? formatDuration(actualTime) : formatPlannerEstimatedCost(totalCost ?? 0)}
                    </span>
                  </span>
                  <span className="min-w-0 text-right">
                    <span className="block text-outline">Rows</span>
                    <span className="block truncate font-mono text-on-surface">{scannedRows != null ? formatRows(scannedRows) : '—'}</span>
                  </span>
                </div>

                {nodeHighlight && (
                  <span className={cn('rounded-full border px-1.5 py-0.5 text-[10px]', getBadgeClasses(nodeHighlight.tone))}>
                    {nodeHighlight.label}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      )}

      <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-3 py-2">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-on-surface">{getNodeType(selectedNode)}</p>
            {selectedRelation && (
              <p className="mt-0.5 truncate font-mono text-[11px] text-on-surface-variant">{selectedRelation}</p>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {selectedCost != null && <MetricPill label="Subtree cost" value={formatPlannerEstimatedCost(selectedCost)} />}
            {selectedRows != null && <MetricPill label="Rows" value={formatRows(selectedRows)} />}
            {selectedTime != null && <MetricPill label="Time" value={formatDuration(selectedTime)} tone="warning" />}
            {selectedBufferStats.hits != null && <MetricPill label="Hits" value={formatRows(selectedBufferStats.hits)} tone="success" />}
            {selectedBufferStats.reads != null && <MetricPill label="Reads" value={formatRows(selectedBufferStats.reads)} tone="warning" />}
            {selectedHighlight && <MetricPill label={selectedHighlight.label} value={selectedHighlight.reason} tone={selectedHighlight.tone} />}
          </div>
        </div>
        {selectedConditions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5 border-t border-outline-variant/10 pt-2">
            {selectedConditions.map((condition) => (
              <span
                key={`${condition.label}-${condition.value}`}
                className="max-w-full truncate rounded-md bg-surface-container-lowest px-2 py-1 font-mono text-[11px] text-on-surface-variant"
                title={`${condition.label}: ${condition.value}`}
              >
                {condition.label}: {condition.value}
              </span>
            ))}
          </div>
        )}
      </div>
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
