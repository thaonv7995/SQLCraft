'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLabStore } from '@/stores/lab';
import toast from 'react-hot-toast';
import {
  useExecuteQuery,
  useExplainQuery,
  useQueryHistory,
  useSessionStatus,
  useSessionSchema,
  useSessionSchemaDiff,
} from '@/hooks/use-query-execution';
import { formatSqlInBrowser } from '@/lib/format-sql';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
} from '@/components/ui/table';
import { cn, formatDuration, formatRows, formatRelativeTime, getExplainPlanMode, truncateSql } from '@/lib/utils';
import {
  challengesApi,
  sandboxesApi,
  sessionsApi,
  type DatasetScale,
  type LearningSession,
  type QueryExecution,
  type QueryResultColumn,
  type SessionSchemaTable,
} from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { SqlEditor } from '@/components/ui/sql-editor';
import { ExecutionPlanTree } from '@/components/lab/execution-plan-tree';
import { markLabBootstrapConsumed, readLabBootstrap } from '@/lib/lab-bootstrap';
import {
  createDefaultLabEditorState,
  readLabEditorState,
  writeLabEditorState,
  type LabEditorTab,
} from '@/lib/lab-editor-tabs';

function sessionIdFromPathname(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  if (!lastSegment) {
    return '';
  }
  return decodeURIComponent(lastSegment);
}

function normalizeMetric(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compareNullableAscending(left: number | null, right: number | null) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function getEffectiveSessionStatus(
  session?: Pick<LearningSession, 'status' | 'sandboxStatus' | 'sandbox'> | null,
): LearningSession['status'] | undefined {
  if (!session) {
    return undefined;
  }

  const sandboxStatus = session.sandbox?.status ?? session.sandboxStatus ?? null;
  const sandboxLooksReady = sandboxStatus === 'ready' || Boolean(session.sandbox?.dbName);

  if (session.status === 'provisioning' && sandboxLooksReady) {
    return 'active';
  }

  return session.status;
}

// ─── Dataset Scale Selector ───────────────────────────────────────────────────

const DATASET_SCALE_META: Record<DatasetScale, { label: string; desc: string }> = {
  tiny: { label: 'Tiny', desc: '100 rows' },
  small: { label: 'Small', desc: '10K rows' },
  medium: { label: 'Medium', desc: '1M-5M rows' },
  large: { label: 'Large', desc: '10M+ rows' },
};

function DatasetScaleSelector({
  selectedScale,
  sourceScale,
  sourceRowCount,
  databaseName,
}: {
  selectedScale: DatasetScale | null;
  sourceScale: DatasetScale | null;
  sourceRowCount: number | null;
  databaseName?: string | null;
}) {
  const sourceScaleLabel = sourceScale ? DATASET_SCALE_META[sourceScale].label : null;
  const sourceSummary =
    typeof sourceRowCount === 'number'
      ? `${formatRows(sourceRowCount)} rows`
      : sourceScaleLabel ?? 'Unknown';

  const hintText = `DB ${databaseName ?? 'N/A'} · Source ${sourceSummary}${
    sourceScaleLabel && typeof sourceRowCount === 'number' ? ` (${sourceScaleLabel})` : ''
  }${selectedScale ? ` · Scale ${DATASET_SCALE_META[selectedScale].label}` : ''}`;

  return (
    <div
      className="inline-flex h-9 items-center gap-2 rounded-lg border border-outline-variant/10 bg-surface-container-low px-3"
      title={hintText}
      aria-label={hintText}
    >
      <span className="text-[10px] uppercase tracking-[0.14em] text-outline">DB</span>
      <span className="max-w-[120px] truncate text-xs font-medium text-on-surface-variant">
        {databaseName ?? 'N/A'}
      </span>
      <span className="text-outline">•</span>
      <span className="text-[10px] uppercase tracking-[0.14em] text-outline">Scale</span>
      <span className="rounded-md bg-surface-container-high px-2 py-1 text-xs font-medium text-on-surface">
        {selectedScale ? DATASET_SCALE_META[selectedScale].label : 'N/A'}
      </span>
    </div>
  );
}

// ─── SQL Editor (CodeMirror 6) ────────────────────────────────────────────────

function EditorTabsBar() {
  const editorTabs = useLabStore((state) => state.editorTabs);
  const activeEditorTabId = useLabStore((state) => state.activeEditorTabId);
  const addEditorTab = useLabStore((state) => state.addEditorTab);
  const setActiveEditorTab = useLabStore((state) => state.setActiveEditorTab);
  const renameEditorTab = useLabStore((state) => state.renameEditorTab);
  const closeEditorTab = useLabStore((state) => state.closeEditorTab);
  const moveEditorTab = useLabStore((state) => state.moveEditorTab);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [draftTabName, setDraftTabName] = useState('');
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const tabsStripRef = useRef<HTMLDivElement | null>(null);

  const beginRename = useCallback((tab: LabEditorTab) => {
    setEditingTabId(tab.id);
    setDraftTabName(tab.name);
  }, []);

  const stopRenaming = useCallback(() => {
    setEditingTabId(null);
    setDraftTabName('');
  }, []);

  const commitRename = useCallback(
    (tabId: string) => {
      const nextName = draftTabName.trim();
      if (nextName) {
        renameEditorTab(tabId, nextName);
      }
      stopRenaming();
    },
    [draftTabName, renameEditorTab, stopRenaming],
  );

  const handleTabsWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const container = tabsStripRef.current;
    if (!container) return;
    if (container.scrollWidth <= container.clientWidth) return;

    const horizontalDelta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    container.scrollLeft += horizontalDelta;
    event.preventDefault();
  }, []);

  return (
    <div className="flex min-w-0 flex-1 items-stretch overflow-hidden">
      <div
        ref={tabsStripRef}
        className="scrollbar-none flex min-w-0 flex-1 items-stretch overflow-x-auto"
        onWheel={handleTabsWheel}
      >
        {editorTabs.map((tab) => {
          const isActive = tab.id === activeEditorTabId;
          const isEditing = tab.id === editingTabId;
          const canClose = editorTabs.length > 1;

          return (
            <div
              key={tab.id}
              draggable={!isEditing}
              onDragStart={(event) => {
                if (isEditing) return;
                setDraggingTabId(tab.id);
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/plain', tab.id);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(event) => {
                event.preventDefault();
                const sourceTabId = draggingTabId ?? event.dataTransfer.getData('text/plain');
                if (sourceTabId && sourceTabId !== tab.id) {
                  moveEditorTab(sourceTabId, tab.id);
                }
                setDraggingTabId(null);
              }}
              onDragEnd={() => setDraggingTabId(null)}
              className={cn(
                'group flex shrink-0 items-center gap-1 border-r border-outline-variant/10 px-2 py-2 transition-colors',
                draggingTabId === tab.id ? 'opacity-60' : '',
                isActive ? 'bg-surface-container text-on-surface' : 'bg-surface-container-low/60 text-on-surface-variant',
              )}
            >
              {isEditing ? (
                <input
                  value={draftTabName}
                  onChange={(event) => setDraftTabName(event.target.value)}
                  onBlur={() => commitRename(tab.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      commitRename(tab.id);
                    }

                    if (event.key === 'Escape') {
                      event.preventDefault();
                      stopRenaming();
                    }
                  }}
                  autoFocus
                  className="w-36 rounded border border-outline-variant/20 bg-surface px-2 py-1 font-mono text-xs text-on-surface outline-none focus:border-primary/40"
                  aria-label="Rename SQL tab"
                />
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setActiveEditorTab(tab.id)}
                    onDoubleClick={() => beginRename(tab)}
                    className="max-w-40 truncate font-mono text-xs"
                    title={`${tab.name} · Double-click to rename`}
                  >
                    {tab.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => closeEditorTab(tab.id)}
                    disabled={!canClose}
                    className={cn(
                      'rounded p-0.5 text-outline transition-colors',
                      canClose ? 'hover:text-on-surface' : 'opacity-0 pointer-events-none',
                    )}
                    title={canClose ? 'Close tab' : undefined}
                    aria-label={canClose ? `Close ${tab.name}` : undefined}
                  >
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                </>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => addEditorTab()}
          className="shrink-0 border-l border-outline-variant/10 px-3 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface"
          title="Add SQL tab"
          aria-label="Add SQL tab"
        >
          <span className="material-symbols-outlined text-lg">add</span>
        </button>
      </div>
    </div>
  );
}

function SqlEditorPanel({
  sessionId,
  schemaTables,
  onFormat,
  onCopy,
  onClear,
  notice,
}: {
  sessionId: string;
  schemaTables?: SessionSchemaTable[];
  onFormat: () => void;
  onCopy: () => void;
  onClear: () => void;
  notice: 'success' | 'error' | 'info' | null;
}) {
  const currentQuery = useLabStore((state) => state.currentQuery);
  const setQuery = useLabStore((state) => state.setQuery);
  const { mutate: executeQuery } = useExecuteQuery();

  const handleExecute = useCallback(() => {
    if (currentQuery.trim()) {
      executeQuery({ sessionId, sql: currentQuery });
    }
  }, [currentQuery, executeQuery, sessionId]);

  return (
    <SqlEditor
      value={currentQuery}
      onChange={setQuery}
      onExecute={handleExecute}
      onFormat={onFormat}
      onCopy={onCopy}
      onClear={onClear}
      notice={notice}
      schema={schemaTables}
      placeholder="-- Write your SQL query here...&#10;-- Press Ctrl+Enter to execute"
      testId="lab-sql-editor"
    />
  );
}

// ─── Results Panel ────────────────────────────────────────────────────────────

function ResultsPanel() {
  const { results, error, isExecuting } = useLabStore();

  if (isExecuting) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin mx-auto" />
          <p className="text-sm text-on-surface-variant">Executing query...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-1 p-4">
        <div className="bg-error/10 rounded-xl p-4 flex gap-3">
          <span className="material-symbols-outlined text-error text-xl shrink-0">error</span>
          <div>
            <p className="text-sm font-medium text-error mb-1">Query Error</p>
            <p className="text-sm font-mono text-on-surface-variant">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <span className="material-symbols-outlined text-4xl text-outline block">
            output
          </span>
          <p className="text-sm text-on-surface-variant">
            Run a query to see results here
          </p>
          <p className="text-xs text-outline">
            Press <kbd className="bg-surface-container-high px-1.5 py-0.5 rounded text-on-surface-variant font-mono">Ctrl+Enter</kbd> to execute
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-auto">
        <Table stickyHeader>
          <TableHeader>
            <TableRow>
              {results.columns.map((col: QueryResultColumn) => (
                <TableHead key={col.name}>
                  {(() => {
                    const dataTypeLabel = typeof col.dataType === 'string' ? col.dataType.trim() : '';
                    const shouldShowDataType =
                      dataTypeLabel.length > 0 && dataTypeLabel.toLowerCase() !== 'unknown';
                    return (
                  <div className="flex flex-col gap-0.5">
                    <span>{col.name}</span>
                    {shouldShowDataType ? (
                      <span className="text-outline font-normal normal-case tracking-normal">
                        {dataTypeLabel}
                      </span>
                    ) : null}
                  </div>
                    );
                  })()}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {results.rows.length === 0 ? (
              <TableEmpty message="Query returned no rows" colSpan={results.columns.length} />
            ) : (
              results.rows.map((row, i) => (
                <TableRow key={i}>
                  {results.columns.map((col) => (
                    <TableCell key={col.name} className="font-mono text-xs">
                      {row[col.name] === null ? (
                        <span className="text-outline italic">NULL</span>
                      ) : (
                        String(row[col.name])
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {results.truncated && (
        <div className="shrink-0 flex items-center gap-2 border-t border-outline-variant/10 bg-surface-container-low px-4 py-2">
          <span className="material-symbols-outlined text-sm text-tertiary">info</span>
          <span className="text-xs text-on-surface-variant">
            Hiển thị{' '}
            <span className="font-mono text-on-surface">{results.rows.length}</span>
            {' '}trong{' '}
            <span className="font-mono text-on-surface">{results.totalRows.toLocaleString()}</span>
            {' '}dòng — kết quả bị giới hạn ở 500 dòng đầu.
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Execution Plan Panel ─────────────────────────────────────────────────────

function ExecutionPlanPanel() {
  const { executionPlan, isExplaining, lastExecution } = useLabStore();
  const [viewMode, setViewMode] = useState<'tree' | 'raw'>('tree');

  if (isExplaining) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-tertiary/30 border-t-tertiary rounded-full animate-spin mx-auto" />
          <p className="text-sm text-on-surface-variant">Generating execution plan...</p>
        </div>
      </div>
    );
  }

  if (!executionPlan) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <span className="material-symbols-outlined text-4xl text-outline block">
            account_tree
          </span>
          <p className="text-sm text-on-surface-variant">
            {lastExecution
              ? 'Execution plan is not available for that statement. Run a supported query or click Explain.'
              : 'Run a supported query and the execution plan will appear here automatically.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-outline-variant/10 bg-surface-container-low/60 px-3 py-1.5">
        <div className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/10 bg-surface-container p-1">
          <button
            type="button"
            onClick={() => setViewMode('tree')}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              viewMode === 'tree'
                ? 'bg-surface-container-high text-on-surface'
                : 'text-on-surface-variant hover:bg-surface-container-high/70 hover:text-on-surface',
            )}
          >
            Tree
          </button>
          <button
            type="button"
            onClick={() => setViewMode('raw')}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
              viewMode === 'raw'
                ? 'bg-surface-container-high text-on-surface'
                : 'text-on-surface-variant hover:bg-surface-container-high/70 hover:text-on-surface',
            )}
          >
            Raw
          </button>
        </div>
        <span className="text-[10px] uppercase tracking-[0.16em] text-outline">Quick</span>
      </div>

      <div className="flex-1 overflow-auto p-2.5 md:p-3">
        {viewMode === 'tree' ? (
          <ExecutionPlanTree
            executionPlan={executionPlan}
            queryDurationMs={lastExecution?.durationMs}
            compact
          />
        ) : (
          <pre className="overflow-auto rounded-xl border border-outline-variant/10 bg-surface-container-lowest p-2.5 text-[10px] font-mono text-on-surface-variant md:p-3">
            {JSON.stringify(executionPlan.plan, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

// ─── Query History Panel ──────────────────────────────────────────────────────

function QueryHistoryPanel({ sessionId }: { sessionId: string }) {
  const setQuery = useLabStore((s) => s.setQuery);
  const [page, setPage] = useState(1);
  const limit = 20;
  const historyQuery = useQueryHistory(sessionId, page, limit);
  const historyItems = historyQuery.data?.items ?? [];
  const totalPages = Math.max(1, historyQuery.data?.totalPages ?? 1);

  useEffect(() => {
    setPage(1);
  }, [sessionId]);

  if (historyQuery.isLoading && historyItems.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <span className="material-symbols-outlined text-4xl text-outline block">hourglass_top</span>
          <p className="text-sm text-on-surface-variant">Loading history...</p>
        </div>
      </div>
    );
  }

  if (historyQuery.isError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <span className="material-symbols-outlined text-4xl text-outline block">error</span>
          <p className="text-sm text-on-surface-variant">Không tải được history</p>
        </div>
      </div>
    );
  }

  if (historyItems.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center space-y-2">
          <span className="material-symbols-outlined text-4xl text-outline block">history</span>
          <p className="text-sm text-on-surface-variant">No queries run yet this session</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      {historyItems.map((q) => (
        <div
          key={q.id}
          className="px-4 py-3 hover:bg-surface-container transition-colors cursor-pointer group"
          onClick={() => setQuery(q.sql)}
        >
          <div className="flex items-center gap-2 mb-1.5">
            <StatusBadge status={q.status} />
            {q.durationMs !== undefined && (
              <span className="text-xs text-on-surface-variant font-mono">
                {formatDuration(q.durationMs)}
              </span>
            )}
            {q.rowCount !== undefined && (
              <span className="text-xs text-on-surface-variant">
                {formatRows(q.rowCount)} rows
              </span>
            )}
            <span className="text-xs text-outline ml-auto">
              {formatRelativeTime(q.createdAt)}
            </span>
          </div>
          <code className="text-xs font-mono text-on-surface-variant block truncate group-hover:text-on-surface transition-colors">
            {truncateSql(q.sql, 70)}
          </code>
        </div>
      ))}
      <div className="mt-auto flex items-center justify-between border-t border-outline-variant/10 px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={page <= 1}
          onClick={() => setPage((prev) => Math.max(1, prev - 1))}
        >
          Prev
        </Button>
        <span className="text-[11px] text-on-surface-variant">
          Page {page}/{totalPages}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

// ─── Schema Panel ─────────────────────────────────────────────────────────────

function SchemaPanelSkeleton() {
  return (
    <div className="flex-1 p-3 space-y-2">
      <div className="h-3 w-20 rounded animate-pulse bg-surface-container mx-2 mb-4" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-9 rounded-lg animate-pulse bg-surface-container" />
      ))}
    </div>
  );
}

function SchemaPanel({ sessionId }: { sessionId: string }) {
  const { data: schema, isLoading, isError } = useSessionSchema(sessionId);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);

  if (isLoading) return <SchemaPanelSkeleton />;

  if (isError || !schema) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <span className="material-symbols-outlined text-3xl text-outline block">error</span>
          <p className="text-xs text-on-surface-variant">Không tải được schema</p>
        </div>
      </div>
    );
  }

  if (schema.tables.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-xs text-on-surface-variant">Không có bảng nào trong schema</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3 space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-outline px-2 mb-3">
        Tables ({schema.tables.length})
      </p>
      {schema.tables.map((table) => {
        const isExpanded = expandedTable === table.name;
        return (
          <div key={table.name} className="rounded-lg overflow-hidden">
            <button
              onClick={() => setExpandedTable(isExpanded ? null : table.name)}
              className="w-full flex items-center gap-2 px-3 py-2 hover:bg-surface-container-high transition-colors text-left rounded-lg"
            >
              <span
                className={cn(
                  'material-symbols-outlined text-base transition-transform text-on-surface-variant',
                  isExpanded ? 'rotate-90' : ''
                )}
              >
                chevron_right
              </span>
              <span className="material-symbols-outlined text-base text-tertiary">table_chart</span>
              <span className="text-sm font-mono text-on-surface">{table.name}</span>
              <span className="text-xs text-outline ml-auto">{table.columns.length} cols</span>
            </button>
            {isExpanded && (
              <div className="ml-8 space-y-0.5 pb-2">
                {table.columns.map((col) => (
                  <div
                    key={col.name}
                    className="flex items-center gap-2 px-3 py-1.5 rounded hover:bg-surface-container transition-colors"
                  >
                    <span
                      className={cn(
                        'material-symbols-outlined text-sm shrink-0',
                        col.isPrimary ? 'text-primary' : col.isForeign ? 'text-secondary' : 'text-outline'
                      )}
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      {col.isPrimary ? 'key' : col.isForeign ? 'link' : 'circle'}
                    </span>
                    <span className="text-xs font-mono text-on-surface-variant flex-1">
                      {col.name}
                    </span>
                    {col.references && (
                      <span className="text-[10px] text-outline font-mono truncate max-w-[80px]" title={col.references}>
                        → {col.references}
                      </span>
                    )}
                    <span className="text-xs font-mono text-outline shrink-0">{col.type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatCompareMetric(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) {
    return '—';
  }
  return String(n);
}

type ComparePreference = 'lower' | 'higher' | 'none';
type CompareLabel = 'A' | 'B' | 'C' | 'D';
type CompareSlot = { label: CompareLabel; execution: QueryExecution };

function getPlanRootNode(plan: unknown): Record<string, unknown> | null {
  if (!plan || typeof plan !== 'object') {
    return null;
  }
  const raw = plan as Record<string, unknown>;
  if (raw.Plan && typeof raw.Plan === 'object') {
    return raw.Plan as Record<string, unknown>;
  }
  return raw;
}

function readScanRows(execution: QueryExecution): number | null {
  const root = getPlanRootNode(execution.executionPlan?.plan);
  if (!root) {
    return null;
  }

  const actualRows =
    typeof root['Actual Rows'] === 'number' && Number.isFinite(root['Actual Rows'])
      ? root['Actual Rows']
      : null;
  const actualLoops =
    typeof root['Actual Loops'] === 'number' && Number.isFinite(root['Actual Loops'])
      ? root['Actual Loops']
      : 1;
  if (actualRows != null) {
    return Math.round(actualRows * actualLoops);
  }

  const planRows =
    typeof root['Plan Rows'] === 'number' && Number.isFinite(root['Plan Rows'])
      ? root['Plan Rows']
      : null;
  return planRows != null ? Math.round(planRows) : null;
}

function findBestIndices(values: Array<number | null>, preference: ComparePreference): Set<number> {
  if (preference === 'none') {
    return new Set();
  }
  const candidates = values
    .map((value, index) => ({ value, index }))
    .filter((entry): entry is { value: number; index: number } => entry.value != null);
  if (candidates.length === 0) {
    return new Set();
  }
  const bestValue =
    preference === 'lower'
      ? Math.min(...candidates.map((c) => c.value))
      : Math.max(...candidates.map((c) => c.value));
  return new Set(candidates.filter((c) => c.value === bestValue).map((c) => c.index));
}

function ComparePlanMetricsTable({ items }: { items: CompareSlot[] }) {
  const rows: Array<{
    key: string;
    label: string;
    values: Array<number | null>;
    display: string[];
    preference: ComparePreference;
  }> = [
    {
      key: 'run',
      label: 'Run (ms)',
      values: items.map((item) => item.execution.durationMs ?? null),
      display: items.map((item) => formatCompareMetric(item.execution.durationMs ?? null)),
      preference: 'lower',
    },
    {
      key: 'rows',
      label: 'Rows',
      values: items.map((item) => item.execution.rowCount ?? null),
      display: items.map((item) => formatCompareMetric(item.execution.rowCount ?? null)),
      preference: 'none',
    },
    {
      key: 'scan-rows',
      label: 'Scan rows',
      values: items.map((item) => readScanRows(item.execution)),
      display: items.map((item) => formatCompareMetric(readScanRows(item.execution))),
      preference: 'lower',
    },
    {
      key: 'plan',
      label: 'Plan (ms)',
      values: items.map((item) =>
        item.execution.executionPlan?.actualTime != null
          ? Math.round(item.execution.executionPlan.actualTime)
          : null,
      ),
      display: items.map((item) =>
        formatCompareMetric(
          item.execution.executionPlan?.actualTime != null
            ? Math.round(item.execution.executionPlan.actualTime)
            : null,
        ),
      ),
      preference: 'lower',
    },
    {
      key: 'cost',
      label: 'Cost',
      values: items.map((item) =>
        item.execution.executionPlan?.totalCost != null
          ? Math.round(item.execution.executionPlan.totalCost)
          : null,
      ),
      display: items.map((item) =>
        formatCompareMetric(
          item.execution.executionPlan?.totalCost != null
            ? Math.round(item.execution.executionPlan.totalCost)
            : null,
        ),
      ),
      preference: 'lower',
    },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant/10">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[28%]">Metric</TableHead>
            {items.map((item) => (
              <TableHead key={item.label} className="tabular-nums">
                {item.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const winners = findBestIndices(row.values, row.preference);
            return (
              <TableRow key={row.key}>
                <TableCell className="text-xs font-medium text-on-surface">{row.label}</TableCell>
                {row.display.map((value, index) => (
                  <TableCell
                    key={`${row.key}-${items[index]?.label ?? index}`}
                    className={cn(
                      'font-mono text-xs tabular-nums text-on-surface',
                      winners.has(index) && 'bg-green-500/15 font-semibold text-green-300',
                    )}
                  >
                    {value}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ChallengeCompareLeaderboardCard({
  challengeVersionId,
  viewerUserId,
}: {
  challengeVersionId: string;
  viewerUserId?: string | null;
}) {
  const leaderboardContextQuery = useQuery({
    queryKey: ['challenge-leaderboard-context', challengeVersionId],
    queryFn: () => challengesApi.getLeaderboardContext(challengeVersionId, 25),
    staleTime: 20_000,
  });

  const ctx = leaderboardContextQuery.data;
  const entries = ctx?.entries ?? [];

  const viewerState =
    !viewerUserId
      ? 'signed-out'
      : ctx?.viewerRank != null && (ctx?.totalRankedUsers ?? 0) > 0
        ? 'ranked'
        : 'unranked';

  return (
    <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low/70 p-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <p className="text-sm font-semibold text-on-surface self-center">Leaderboard</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:min-w-[280px]">
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-high/50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.14em] text-outline">Hạng bạn</p>
            <p className="mt-1 text-sm font-semibold text-on-surface">
              {viewerState === 'ranked'
                ? `#${ctx?.viewerRank}`
                : viewerState === 'signed-out'
                  ? 'Chưa đăng nhập'
                  : 'Chưa có hạng'}
            </p>
          </div>
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-high/50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.14em] text-outline">Đã pass</p>
            <p className="mt-1 text-sm font-semibold text-on-surface">{ctx?.totalRankedUsers ?? '—'}</p>
          </div>
        </div>
      </div>

      {leaderboardContextQuery.isLoading ? (
        <div className="mt-4 h-24 animate-pulse rounded-xl bg-surface-container-high/60" />
      ) : leaderboardContextQuery.isError ? (
        <p className="mt-4 text-xs text-error">Lỗi tải bảng.</p>
      ) : entries.length === 0 ? (
        <p className="mt-4 text-xs text-on-surface-variant">Chưa có bản pass.</p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-outline-variant/10">
          <div className="grid grid-cols-[44px_minmax(120px,1fr)_72px_72px_72px] gap-x-2 border-b border-outline-variant/10 bg-surface-container-low px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-outline">
            <span>#</span>
            <span>User</span>
            <span>ms</span>
            <span>Cost</span>
            <span className="text-right"></span>
          </div>
          <ul className="max-h-72 divide-y divide-outline-variant/10 overflow-auto">
            {entries.map((entry) => {
              const isViewer = Boolean(viewerUserId && entry.userId === viewerUserId);
              return (
                <li
                  key={entry.attemptId}
                  className={cn(
                    'grid grid-cols-[44px_minmax(120px,1fr)_72px_72px_72px] items-center gap-x-2 px-3 py-2',
                    isViewer && 'bg-primary/8',
                  )}
                >
                  <span className="text-xs font-semibold tabular-nums text-on-surface">#{entry.rank}</span>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-on-surface">
                      {entry.displayName}
                      {isViewer ? <span className="ml-1 text-primary">(bạn)</span> : null}
                    </p>
                    <p className="truncate font-mono text-[10px] text-on-surface-variant" title={entry.sqlText}>
                      {truncateSql(entry.sqlText, 68)}
                    </p>
                  </div>
                  <span className="text-[11px] tabular-nums text-on-surface-variant">
                    {entry.bestDurationMs != null ? `${entry.bestDurationMs} ms` : '—'}
                  </span>
                  <span className="text-[11px] tabular-nums text-on-surface-variant">
                    {entry.bestTotalCost != null ? Math.round(entry.bestTotalCost) : '—'}
                  </span>
                  <div className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-1.5 text-[11px]"
                      onClick={() => {
                        void navigator.clipboard.writeText(entry.sqlText).then(() => {
                          toast.success('Đã copy');
                        });
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {ctx?.viewerEntry?.sqlText ? (
        <div className="mt-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(ctx.viewerEntry!.sqlText).then(() => {
                toast.success('Đã copy');
              });
            }}
          >
            Copy SQL của tôi
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SideBySideComparePanel({
  queryHistory,
  challengeVersionId,
}: {
  queryHistory: QueryExecution[];
  challengeVersionId?: string | null;
}) {
  const viewerUserId = useAuthStore((s) => s.user?.id ?? null);
  const compareLabels: CompareLabel[] = ['A', 'B', 'C', 'D'];
  const [picks, setPicks] = useState<string[]>(['', '', '', '']);
  const [activeSlotCount, setActiveSlotCount] = useState(2);

  const executions = useMemo(() => {
    return [...queryHistory]
      .filter((e) => e.status === 'success' || e.status === 'error')
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }, [queryHistory]);

  useEffect(() => {
    const available = executions.map((e) => e.id);
    setPicks((prev) => {
      const next = [...prev];
      const used = new Set<string>();
      for (let i = 0; i < compareLabels.length; i += 1) {
        const current = next[i];
        if (current && available.includes(current) && !used.has(current)) {
          used.add(current);
          continue;
        }
        const fallback = available.find((id) => !used.has(id)) ?? '';
        next[i] = fallback;
        if (fallback) used.add(fallback);
      }
      return next;
    });
  }, [executions]);

  useEffect(() => {
    setActiveSlotCount((prev) => Math.min(Math.max(2, prev), compareLabels.length));
  }, []);

  const selectedItems = useMemo(() => {
    return compareLabels.reduce<CompareSlot[]>((acc, label, index) => {
        if (index >= activeSlotCount) {
          return acc;
        }
        const id = picks[index];
        const execution = executions.find((e) => e.id === id);
        if (execution) {
          acc.push({ label, execution });
        }
        return acc;
      }, []);
  }, [activeSlotCount, executions, picks]);

  const introHint = 'Plan / timing · History';

  const selectClass =
    'w-full appearance-none rounded-lg border border-outline-variant/20 bg-surface-container-high pl-2 pr-8 py-2 text-xs text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/30';

  const addCompareSlot = () => {
    setActiveSlotCount((prev) => {
      if (prev >= compareLabels.length) {
        return prev;
      }
      const nextCount = prev + 1;
      const nextIndex = nextCount - 1;
      setPicks((oldPicks) => {
        const nextPicks = [...oldPicks];
        const used = new Set(nextPicks.slice(0, prev).filter(Boolean));
        const candidate = executions.find((e) => !used.has(e.id))?.id ?? '';
        nextPicks[nextIndex] = candidate;
        return nextPicks;
      });
      return nextCount;
    });
  };

  const removeCompareSlot = (slotIndex: number) => {
    if (slotIndex < 2) return;
    setPicks((oldPicks) => {
      const next = [...oldPicks];
      for (let i = slotIndex; i < activeSlotCount - 1; i += 1) {
        next[i] = next[i + 1] ?? '';
      }
      next[Math.max(0, activeSlotCount - 1)] = '';
      return next;
    });
    setActiveSlotCount((prev) => Math.max(2, prev - 1));
  };

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="space-y-4">
        {challengeVersionId ? (
          <ChallengeCompareLeaderboardCard challengeVersionId={challengeVersionId} viewerUserId={viewerUserId} />
        ) : null}

        <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low/70 p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-sm font-medium text-on-surface">So sánh</p>
            <div className="flex items-center gap-1.5">
              <p className="text-[11px] text-on-surface-variant">{introHint}</p>
              <button
                type="button"
                className={cn(
                  'inline-flex h-5 w-5 items-center justify-center rounded border text-on-surface-variant transition-colors',
                  activeSlotCount < compareLabels.length
                    ? 'border-outline-variant/20 hover:bg-surface-container-high hover:text-on-surface'
                    : 'cursor-not-allowed border-outline-variant/10 opacity-40',
                )}
                onClick={addCompareSlot}
                disabled={activeSlotCount >= compareLabels.length}
                title="Thêm 1 query compare"
              >
                <span className="material-symbols-outlined text-[14px] leading-none">add</span>
              </button>
            </div>
          </div>

          {executions.length < 2 ? (
            <div className="mt-3 rounded-lg border border-dashed border-outline-variant/25 bg-surface-container-high/30 px-3 py-2.5 text-[11px] text-on-surface-variant">
              Cần thêm ít nhất 1 lần chạy trong History.
            </div>
          ) : (
            <>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {compareLabels.slice(0, activeSlotCount).map((label, slotIndex) => {
                const current = picks[slotIndex] ?? '';
                const blocked = new Set(picks.filter((id, i) => i !== slotIndex && id));
                return (
                  <div key={label} className="relative">
                  <label className="block">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-9 min-w-9 items-center justify-center rounded-md bg-surface-container-high px-1.5 text-[11px] font-semibold text-on-surface-variant">
                        {label}
                      </span>
                    <div className="relative flex-1">
                      <select
                        className={selectClass}
                        value={current}
                        onChange={(e) => {
                          const value = e.target.value;
                          setPicks((prev) => {
                            const next = [...prev];
                            for (let i = 0; i < next.length; i += 1) {
                              if (i !== slotIndex && value && next[i] === value) {
                                next[i] = '';
                              }
                            }
                            next[slotIndex] = value;
                            return next;
                          });
                        }}
                      >
                        <option value="">Không chọn</option>
                        {executions
                          .filter((e) => !blocked.has(e.id) || e.id === current)
                          .map((e) => (
                            <option key={e.id} value={e.id}>
                              {formatRelativeTime(e.createdAt)} · {e.durationMs ?? '—'}ms · {truncateSql(e.sql, 48)}
                            </option>
                          ))}
                      </select>
                      <span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-on-surface-variant">
                        <span className="material-symbols-outlined block text-[16px] leading-none">expand_more</span>
                      </span>
                    </div>
                    </div>
                  </label>
                  {slotIndex >= 2 ? (
                    <button
                      type="button"
                      className="absolute -right-1 -top-1 z-10 inline-flex h-4 w-4 items-center justify-center rounded-full border border-red-300/30 bg-red-400/8 text-red-100/85 hover:bg-red-400/14"
                      onClick={() => removeCompareSlot(slotIndex)}
                      title={`Xóa slot ${label}`}
                    >
                      <span className="material-symbols-outlined text-[11px] leading-none">remove</span>
                    </button>
                  ) : null}
                  </div>
                );
              })}
              </div>
            </>
          )}
        </div>

        {selectedItems.length >= 2 ? <ComparePlanMetricsTable items={selectedItems} /> : null}
      </div>
    </div>
  );
}

function EndSessionModal({
  open,
  isPending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open || isPending) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPending, onCancel, open]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={() => {
        if (!isPending) {
          onCancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-session-title"
        aria-describedby="end-session-description"
        className="w-full max-w-md rounded-xl border border-outline-variant/15 bg-surface-container-low p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-error/10 text-error">
            <span className="material-symbols-outlined text-[22px]">stop_circle</span>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
              Sandbox Control
            </p>
            <h2 id="end-session-title" className="mt-1 text-lg font-semibold text-on-surface">
              End this session?
            </h2>
            <p id="end-session-description" className="mt-2 text-sm leading-6 text-on-surface-variant">
              This will stop the current sandbox immediately. To keep working later, you will need
              to start a new session.
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-high/50 px-4 py-3 text-xs leading-5 text-on-surface-variant">
          Any unsaved state inside this running sandbox will be discarded once shutdown begins.
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={isPending}
            onClick={onConfirm}
            leftIcon={<span className="material-symbols-outlined text-[18px]">stop_circle</span>}
          >
            End Session
          </Button>
        </div>
      </div>
    </div>
  );
}

function SchemaDiffEntry({
  tone,
  title,
  subtitle,
  tableName,
  fields,
  definition,
  previousDefinition,
}: {
  tone: 'added' | 'removed' | 'changed';
  title: string;
  subtitle?: string | null;
  tableName?: string | null;
  fields?: string[] | null;
  definition?: string | null;
  previousDefinition?: string | null;
}) {
  const toneClass =
    tone === 'added'
      ? 'border-secondary/20 bg-secondary/10'
      : tone === 'removed'
        ? 'border-error/20 bg-error/10'
        : 'border-tertiary/20 bg-tertiary/10';
  const label =
    tone === 'added' ? 'Added' : tone === 'removed' ? 'Removed' : 'Changed';

  return (
    <div className={cn('rounded-lg border px-2.5 py-2', toneClass)}>
      <div className="flex items-start justify-between gap-2">
        <p className="truncate text-sm font-medium text-on-surface">{title}</p>
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-outline">
          {label}
        </span>
      </div>
      {tableName ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="rounded-md border border-outline-variant/20 bg-surface-container-high px-1.5 py-0.5 text-outline">
            table
          </span>
          <span className="rounded-md bg-surface-container-high px-1.5 py-0.5 font-mono text-on-surface">
            {tableName}
          </span>
          {fields && fields.length > 0 ? (
            <>
              <span className="ml-1 rounded-md border border-outline-variant/20 bg-surface-container-high px-1.5 py-0.5 text-outline">
                fields
              </span>
              <span className="rounded-md bg-surface-container-high px-1.5 py-0.5 font-mono text-on-surface">
                {fields.join(', ')}
              </span>
            </>
          ) : null}
        </div>
      ) : null}
      {subtitle ? (
        <p className="mt-1 text-xs text-on-surface-variant">{subtitle}</p>
      ) : null}
      {previousDefinition ? (
        <div className="mt-3 space-y-2 text-[11px]">
          <div>
            <p className="mb-1 uppercase tracking-[0.16em] text-outline">Base</p>
            <pre className="max-h-36 overflow-auto rounded-lg bg-surface-container-high px-3 py-2 font-mono text-outline">
              {previousDefinition}
            </pre>
          </div>
          <div>
            <p className="mb-1 uppercase tracking-[0.16em] text-outline">Current</p>
            <pre className="max-h-36 overflow-auto rounded-lg bg-surface-container-high px-3 py-2 font-mono text-on-surface-variant">
              {definition}
            </pre>
          </div>
        </div>
      ) : definition ? (
        <pre className="mt-3 max-h-40 overflow-auto rounded-lg bg-surface-container-high px-3 py-2 font-mono text-[11px] text-on-surface-variant">
          {definition}
        </pre>
      ) : null}
    </div>
  );
}

function SchemaDiffPanel({
  sessionId,
  onReset,
  isResetting,
}: {
  sessionId: string;
  onReset: () => void;
  isResetting: boolean;
}) {
  const { data: diff, isLoading, isError, error } = useSessionSchemaDiff(sessionId);
  const extractIndexFields = (definition?: string | null): string[] => {
    if (!definition) return [];
    const match = definition.match(/\(([^)]+)\)/);
    if (!match?.[1]) return [];
    return match[1]
      .split(',')
      .map((part) => part.trim())
      .map((part) =>
        part
          .replace(/\s+(asc|desc)\b/gi, '')
          .replace(/\s+nulls\s+(first|last)\b/gi, '')
          .replace(/"/g, ''),
      )
      .filter(Boolean);
  };
  const totalChanges = diff
    ? diff.indexes.added.length +
      diff.indexes.removed.length +
      diff.indexes.changed.length +
      diff.views.added.length +
      diff.views.removed.length +
      diff.views.changed.length +
      diff.materializedViews.added.length +
      diff.materializedViews.removed.length +
      diff.materializedViews.changed.length +
      diff.functions.added.length +
      diff.functions.removed.length +
      diff.functions.changed.length +
      diff.partitions.added.length +
      diff.partitions.removed.length +
      diff.partitions.changed.length
    : 0;

  const renderSection = <T,>(
    title: string,
    icon: string,
    section: {
      added: T[];
      removed: T[];
      changed: Array<{ base: T; current: T }>;
    },
    describe: (item: T) => {
      title: string;
      subtitle?: string | null;
      tableName?: string | null;
      fields?: string[] | null;
      definition?: string | null;
    },
    describeChanged?: (item: T) => {
      title: string;
      subtitle?: string | null;
      tableName?: string | null;
      fields?: string[] | null;
      definition?: string | null;
    },
  ) => {
    const changeCount = section.added.length + section.removed.length + section.changed.length;

    if (changeCount === 0) {
      return null;
    }

    return (
      <div key={title} className="rounded-xl border border-outline-variant/10 bg-surface-container-low/70 p-3">
        <div className="mb-2 flex items-center gap-2">
          <span className="material-symbols-outlined text-base text-tertiary">{icon}</span>
          <div>
            <p className="text-xs font-semibold text-on-surface">{title}</p>
            <p className="text-[11px] text-outline">
              {changeCount} change{changeCount === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
          {section.added.map((item) => {
            const formatted = describe(item);
            return (
              <SchemaDiffEntry
                key={`added-${formatted.title}`}
                tone="added"
                title={formatted.title}
                subtitle={formatted.subtitle}
                tableName={formatted.tableName}
                fields={formatted.fields}
                definition={formatted.definition}
              />
            );
          })}
          {section.removed.map((item) => {
            const formatted = describe(item);
            return (
              <SchemaDiffEntry
                key={`removed-${formatted.title}`}
                tone="removed"
                title={formatted.title}
                subtitle={formatted.subtitle}
                tableName={formatted.tableName}
                fields={formatted.fields}
                definition={formatted.definition}
              />
            );
          })}
          {section.changed.map((item) => {
            const currentFormatted = (describeChanged ?? describe)(item.current);
            const baseFormatted = describe(item.base);
            return (
              <SchemaDiffEntry
                key={`changed-${currentFormatted.title}`}
                tone="changed"
                title={currentFormatted.title}
                subtitle={currentFormatted.subtitle}
                tableName={currentFormatted.tableName}
                fields={currentFormatted.fields}
                definition={currentFormatted.definition}
                previousDefinition={baseFormatted.definition}
              />
            );
          })}
        </div>
      </div>
    );
  };

  if (isLoading) {
    return <SchemaPanelSkeleton />;
  }

  if (isError || !diff) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-sm text-center space-y-2">
          <span className="material-symbols-outlined text-3xl text-outline block">difference</span>
          <p className="text-xs text-on-surface-variant">
            {error instanceof Error ? error.message : 'Unable to load schema diff'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-3">
      <div className="space-y-3">
        <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-on-surface">Schema Diff</p>
              <p className="text-[11px] text-on-surface-variant">
                {diff.hasChanges ? `${totalChanges} changes` : 'No drift'}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={isResetting}
              onClick={onReset}
              className="h-7 whitespace-nowrap px-2.5 text-[11px]"
            >
              Reset về base
            </Button>
          </div>
        </div>

        {!diff.hasChanges ? (
          <div className="rounded-xl border border-dashed border-outline-variant/20 bg-surface-container-low px-3 py-6 text-center text-xs text-on-surface-variant">
            No schema drift.
          </div>
        ) : (
          <div className="grid gap-3">
            {renderSection(
              'Indexes',
              'database',
              diff.indexes,
              (item) => ({
                title: item.name,
                subtitle: null,
                tableName: item.tableName,
                fields: extractIndexFields(item.definition),
                definition: null,
              }),
            )}
            {renderSection(
              'Views',
              'preview',
              diff.views,
              (item) => ({
                title: item.name,
                definition: null,
              }),
            )}
            {renderSection(
              'Materialized Views',
              'inventory_2',
              diff.materializedViews,
              (item) => ({
                title: item.name,
                definition: null,
              }),
            )}
            {renderSection(
              'Functions',
              'code_blocks',
              diff.functions,
              (item) => ({
                title: `${item.name}(${item.signature})`,
                subtitle: item.language ? `Language ${item.language}` : null,
                definition: null,
              }),
            )}
            {renderSection(
              'Partitions',
              'splitscreen',
              diff.partitions,
              (item) => ({
                title: item.name,
                subtitle: `${item.parentTable}${item.strategy ? ` · ${item.strategy}` : ''}`,
                definition: null,
              }),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Session Expired / Ended Overlay ─────────────────────────────────────────

function LabSessionExpired({ status }: { status: string }) {
  const label =
    status === 'expired' ? 'Phiên lab đã hết hạn' :
    status === 'failed'  ? 'Phiên lab gặp lỗi' :
                           'Phiên lab đã kết thúc';
  const desc =
    status === 'failed'
      ? 'Sandbox không thể khởi động. Hãy thử tạo phiên mới.'
      : 'Session này không còn hoạt động. Tạo phiên mới để tiếp tục thực hành.';

  return (
    <div className="flex-1 flex items-center justify-center bg-surface">
      <div className="text-center space-y-4 px-4">
        <span className="material-symbols-outlined text-5xl text-outline block">
          {status === 'failed' ? 'error' : 'timer_off'}
        </span>
        <div className="space-y-1.5">
          <h2 className="text-base font-semibold text-on-surface">{label}</h2>
          <p className="text-sm text-on-surface-variant max-w-sm">{desc}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
          <Link href="/explore">
            <Button
              variant="primary"
              leftIcon={<span className="material-symbols-outlined text-lg">travel_explore</span>}
            >
              Chọn database mới
            </Button>
          </Link>
          <Link href="/lab">
            <Button variant="secondary">Về SQL Lab</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Main Lab Page ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'results', label: 'Results', icon: 'table_rows' },
  { id: 'plan', label: 'Execution Plan', icon: 'account_tree' },
  { id: 'compare', label: 'Compare', icon: 'compare_arrows' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'schema', label: 'Schema', icon: 'schema' },
] as const;

type TabId = typeof TABS[number]['id'];

function LabSessionLoading() {
  return (
    <div className="flex flex-1 flex-col bg-surface">
      <div className="h-12 shrink-0 animate-pulse border-b border-outline-variant/10 bg-surface-container-low" />
      <div className="flex flex-1 gap-0 overflow-hidden">
        <div className="w-[55%] animate-pulse bg-surface-container-lowest" />
        <div className="flex-1 animate-pulse bg-surface-container-low" />
      </div>
      <div className="h-6 shrink-0 animate-pulse border-t border-outline-variant/10 bg-surface-container-lowest" />
    </div>
  );
}

function LabSessionError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 bg-surface px-4">
      <span className="material-symbols-outlined text-5xl text-outline">cloud_off</span>
      <div className="max-w-md text-center">
        <h1 className="font-headline text-xl font-semibold text-on-surface">Không tải được phiên lab</h1>
        <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">{message}</p>
        <p className="mt-3 text-xs text-outline">
          Kiểm tra API đang chạy, bạn đã đăng nhập, và phiên còn tồn tại trên server.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" onClick={onRetry} leftIcon={<span className="material-symbols-outlined text-lg">refresh</span>}>
          Thử lại
        </Button>
        <Link href="/lab">
          <Button variant="secondary">Về SQL Lab</Button>
        </Link>
        <Link href="/explore">
          <Button variant="ghost">Catalog</Button>
        </Link>
      </div>
    </div>
  );
}

export default function LabPage() {
  const pathname = usePathname();
  const router = useRouter();
  const sessionId = sessionIdFromPathname(pathname);
  const {
    activeTab,
    setActiveTab,
    isExecuting,
    isExplaining,
    lastExecution,
    queryHistory,
    results,
    error,
    editorTabs,
    activeEditorTabId,
    currentEditorTabName,
    currentQuery,
    hydrateEditorTabs,
    setQuery,
    selectedScale,
    sourceScale,
    availableScales,
    sourceRowCount,
    setSelectedScale,
  } = useLabStore();

  const { mutate: executeQuery } = useExecuteQuery();
  const { mutate: explainQuery } = useExplainQuery();
  const queryClient = useQueryClient();
  const { data: persistedHistoryPage } = useQueryHistory(sessionId, 1, 100);

  const {
    data: session,
    isLoading: sessionLoading,
    isError: sessionError,
    error: sessionFetchError,
    refetch: refetchSession,
  } = useSessionStatus(sessionId);
  const { data: sessionSchema } = useSessionSchema(sessionId);
  const lessonContext = useMemo(() => readLabBootstrap(sessionId), [sessionId]);
  const { data: challengeAttempts = [] } = useQuery({
    queryKey: ['challenge-attempts', session?.challengeVersionId],
    queryFn: () => challengesApi.listAttempts(session!.challengeVersionId!),
    enabled: Boolean(session?.challengeVersionId),
    staleTime: 15_000,
  });
  const entryPath = lessonContext?.challengePath ?? lessonContext?.lessonPath ?? null;
  const entryLabel = lessonContext?.challengePath
    ? 'Back to challenge'
    : lessonContext?.lessonPath
      ? 'Back'
      : null;
  const lessonTitle = session?.lessonTitle ?? lessonContext?.lessonTitle;
  const displayDatabaseName =
    lessonContext?.databaseName?.trim() ||
    lessonContext?.lessonTitle?.trim() ||
    session?.databaseName?.trim() ||
    session?.displayTitle?.trim() ||
    session?.lessonTitle?.trim() ||
    'N/A';
  const latestSuccessfulExecution =
    queryHistory.find((execution) => execution.status === 'success') ?? null;
  const bestChallengeAttempt = challengeAttempts
    .filter((attempt) => attempt.status === 'passed')
    .reduce<(typeof challengeAttempts)[number] | null>((best, attempt) => {
      if (!best) {
        return attempt;
      }

      const durationComparison = compareNullableAscending(
        normalizeMetric(attempt.queryExecution.durationMs),
        normalizeMetric(best.queryExecution.durationMs),
      );
      if (durationComparison < 0) {
        return attempt;
      }
      if (durationComparison > 0) {
        return best;
      }

      const costComparison = compareNullableAscending(
        normalizeMetric(attempt.queryExecution.totalCost),
        normalizeMetric(best.queryExecution.totalCost),
      );
      if (costComparison < 0) {
        return attempt;
      }
      if (costComparison > 0) {
        return best;
      }

      return new Date(attempt.submittedAt) < new Date(best.submittedAt) ? attempt : best;
    }, null);
  const latestChallengeAttempt = challengeAttempts[0] ?? null;
  const explainPlanMode = getExplainPlanMode(currentQuery);
  const effectiveSessionStatus = getEffectiveSessionStatus(session);
  const isSessionReady = effectiveSessionStatus === 'active';
  const isInteractiveSession =
    !session || ['active', 'provisioning', 'paused'].includes(effectiveSessionStatus ?? session.status);
  const submitAttemptMutation = useMutation({
    mutationFn: async () => {
      if (!session?.challengeVersionId) {
        throw new Error('This lab session is not linked to a published challenge');
      }

      if (!latestSuccessfulExecution) {
        throw new Error('Run a successful query before submitting an attempt');
      }

      return challengesApi.submitAttempt({
        learningSessionId: sessionId,
        queryExecutionId: latestSuccessfulExecution.id,
      });
    },
    onSuccess: (attempt) => {
      queryClient.invalidateQueries({
        queryKey: ['challenge-attempts', session?.challengeVersionId],
      });
      if (session?.challengeVersionId) {
        queryClient.invalidateQueries({
          queryKey: ['challenge-leaderboard-context', session.challengeVersionId],
        });
      }
      const feedback = attempt.evaluation?.feedbackText;
      toast.success(
        attempt.status === 'passed'
          ? feedback
            ? `Challenge passed. +${attempt.score ?? 0} pts. ${feedback}`
            : `Challenge passed. +${attempt.score ?? 0} pts.`
          : feedback
            ? `Challenge requirements not met. ${feedback}`
            : 'Challenge requirements not met.',
        { duration: 4000 },
      );
      setActiveTab('history');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to submit challenge attempt');
    },
  });
  const scaleSwitchMutation = useMutation({
    mutationFn: async (nextScale: DatasetScale) => {
      return sandboxesApi.reset(sessionId, nextScale);
    },
    onMutate: (nextScale) => {
      const previousSession = useLabStore.getState().session;
      setSelectedScale(nextScale);
      useLabStore.getState().resetResults();
      useLabStore.setState({ queryHistory: [] });

      if (previousSession) {
        useLabStore.getState().setSession({
          ...previousSession,
          status: 'provisioning',
          selectedScale: nextScale,
        });
      }

      return { previousSession };
    },
    onSuccess: () => {
      toast.success('Sandbox reprovision started for selected scale.');
    },
    onError: (err, _nextScale, context) => {
      if (context?.previousSession) {
        useLabStore.getState().setSession(context.previousSession);
      }
      toast.error(err instanceof Error ? err.message : 'Failed to reprovision sandbox');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['session-status', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['session-schema', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['session-schema-diff', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['query-history', sessionId] });
    },
  });
  const resetSandboxMutation = useMutation({
    mutationFn: async () => {
      return sandboxesApi.reset(sessionId, selectedScale ?? undefined);
    },
    onMutate: () => {
      const previousSession = useLabStore.getState().session;
      useLabStore.getState().resetResults();
      useLabStore.setState({ queryHistory: [] });

      if (previousSession) {
        useLabStore.getState().setSession({
          ...previousSession,
          status: 'provisioning',
        });
      }

      return { previousSession };
    },
    onSuccess: () => {
      toast.success('Sandbox reset started from the base template.');
    },
    onError: (err, _payload, context) => {
      if (context?.previousSession) {
        useLabStore.getState().setSession(context.previousSession);
      }
      toast.error(err instanceof Error ? err.message : 'Failed to reset sandbox');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['session-status', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['session-schema', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['session-schema-diff', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['query-history', sessionId] });
    },
  });
  const endSessionMutation = useMutation({
    mutationFn: async () => sessionsApi.end(sessionId),
    onSuccess: () => {
      setIsEndSessionModalOpen(false);
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['session-status', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['session-schema', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['session-schema-diff', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['query-history', sessionId] });
      toast.success('Session ended. Sandbox is shutting down.');
      router.replace(entryPath ?? '/lab');
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to end session');
    },
  });

  const hydratedEditorSessionIdRef = useRef<string | null>(null);
  const [isEndSessionModalOpen, setIsEndSessionModalOpen] = useState(false);
  const [editorNotice, setEditorNotice] = useState<'success' | 'error' | 'info' | null>(null);
  const editorNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistedEditorState = useMemo(
    () => (sessionId ? readLabEditorState(sessionId) : null),
    [sessionId],
  );
  const hasPersistedEditorTabs = Boolean(persistedEditorState);

  useEffect(() => {
    if (activeTab === 'schemaDiff') {
      setActiveTab('schema');
    }
  }, [activeTab, setActiveTab]);

  useEffect(() => {
    if (!sessionId || hydratedEditorSessionIdRef.current === sessionId) {
      return;
    }

    if (persistedEditorState) {
      hydrateEditorTabs(persistedEditorState.tabs, persistedEditorState.activeTabId);
    } else {
      const bootstrap = readLabBootstrap(sessionId);
      const bootstrapStarterQuery =
        !bootstrap?.starterQueryConsumed && bootstrap?.starterQuery?.trim()
          ? bootstrap.starterQuery
          : undefined;
      const defaultEditorState = createDefaultLabEditorState(bootstrapStarterQuery);
      hydrateEditorTabs(defaultEditorState.tabs, defaultEditorState.activeTabId);
    }

    hydratedEditorSessionIdRef.current = sessionId;
  }, [hydrateEditorTabs, persistedEditorState, sessionId]);

  useEffect(() => {
    const persistedItems = persistedHistoryPage?.items ?? [];
    if (!sessionId || persistedItems.length === 0) {
      return;
    }

    useLabStore.setState((state) => {
      const current = state.queryHistory ?? [];
      const merged = [...current];
      const seen = new Set(current.map((item) => item.id));

      for (const item of persistedItems) {
        if (!seen.has(item.id)) {
          merged.push(item);
          seen.add(item.id);
        }
      }

      merged.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

      const sameLength = merged.length === current.length;
      const unchanged =
        sameLength && merged.every((item, index) => item.id === current[index]?.id);

      if (unchanged) {
        return state;
      }

      return {
        ...state,
        queryHistory: merged.slice(0, 100),
      };
    });
  }, [persistedHistoryPage, sessionId]);

  useEffect(() => {
    if (!sessionId || hydratedEditorSessionIdRef.current !== sessionId) {
      return;
    }

    writeLabEditorState(sessionId, {
      tabs: editorTabs,
      activeTabId: activeEditorTabId,
    });
  }, [activeEditorTabId, editorTabs, sessionId]);

  useEffect(() => {
    if (!sessionId || hydratedEditorSessionIdRef.current !== sessionId) {
      return;
    }

    const bootstrap = readLabBootstrap(sessionId);

    if (!bootstrap) {
      return;
    }

    if (hasPersistedEditorTabs) {
      markLabBootstrapConsumed(sessionId);
      return;
    }

    if (bootstrap.starterQueryConsumed || !bootstrap.starterQuery?.trim()) {
      return;
    }

    setQuery(bootstrap.starterQuery);
    markLabBootstrapConsumed(sessionId);
  }, [hasPersistedEditorTabs, sessionId, setQuery]);

  // Global keyboard shortcut: Ctrl+Enter to execute (must run before any conditional return — Rules of Hooks)
  useEffect(() => {
    if (!sessionId || !isSessionReady) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!isExecuting && currentQuery.trim()) {
          executeQuery({ sessionId, sql: currentQuery });
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isSessionReady, sessionId, currentQuery, isExecuting, executeQuery]);

  const [leftWidth, setLeftWidth] = useState(55); // percent
  const resizing = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [schemaTopHeight, setSchemaTopHeight] = useState(50); // percent
  const schemaResizing = useRef(false);
  const schemaContainerRef = useRef<HTMLDivElement>(null);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizing.current = true;

    const onMouseMove = (me: MouseEvent) => {
      if (!resizing.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((me.clientX - rect.left) / rect.width) * 100;
      setLeftWidth(Math.min(80, Math.max(25, pct)));
    };

    const onMouseUp = () => {
      resizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const handleSchemaResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    schemaResizing.current = true;

    const onMouseMove = (me: MouseEvent) => {
      if (!schemaResizing.current || !schemaContainerRef.current) return;
      const rect = schemaContainerRef.current.getBoundingClientRect();
      const pct = ((me.clientY - rect.top) / rect.height) * 100;
      setSchemaTopHeight(Math.min(80, Math.max(20, pct)));
    };

    const onMouseUp = () => {
      schemaResizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const handleFormatSql = useCallback(() => {
    try {
      setQuery(formatSqlInBrowser(currentQuery));
      setEditorNotice('success');
    } catch (e) {
      setEditorNotice('error');
    }
  }, [currentQuery, setQuery]);

  const handleCopyQuery = useCallback(() => {
    navigator.clipboard
      .writeText(currentQuery)
      .then(() => setEditorNotice('success'))
      .catch(() => setEditorNotice('error'));
  }, [currentQuery]);

  const handleClearEditor = useCallback(() => {
    setQuery('');
    useLabStore.getState().resetResults();
  }, [setQuery]);
  const handleOpenEndSessionModal = useCallback(() => {
    setIsEndSessionModalOpen(true);
  }, [setIsEndSessionModalOpen]);

  const handleCloseEndSessionModal = useCallback(() => {
    if (!endSessionMutation.isPending) {
      setIsEndSessionModalOpen(false);
    }
  }, [endSessionMutation.isPending, setIsEndSessionModalOpen]);

  const handleConfirmEndSession = useCallback(() => {
    endSessionMutation.mutate();
  }, [endSessionMutation]);

  useEffect(() => {
    if (!editorNotice) {
      return;
    }

    if (editorNoticeTimeoutRef.current) {
      clearTimeout(editorNoticeTimeoutRef.current);
    }

    editorNoticeTimeoutRef.current = setTimeout(() => {
      setEditorNotice(null);
      editorNoticeTimeoutRef.current = null;
    }, 1200);

    return () => {
      if (editorNoticeTimeoutRef.current) {
        clearTimeout(editorNoticeTimeoutRef.current);
        editorNoticeTimeoutRef.current = null;
      }
    };
  }, [editorNotice]);

  useEffect(() => {
    if (!lastExecution) {
      return;
    }
    setEditorNotice(lastExecution.status === 'success' ? 'success' : 'error');
  }, [lastExecution]);

  if (!sessionId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-surface px-4">
        <p className="text-sm text-on-surface-variant">Đường dẫn phiên không hợp lệ.</p>
        <Link href="/lab">
          <Button variant="primary">Về SQL Lab</Button>
        </Link>
      </div>
    );
  }

  if (sessionLoading) {
    return <LabSessionLoading />;
  }

  if (sessionError) {
    return (
      <LabSessionError
        message={sessionFetchError instanceof Error ? sessionFetchError.message : 'Lỗi không xác định'}
        onRetry={() => void refetchSession()}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
      <header className="shrink-0 border-b border-outline-variant/10 bg-surface-container-low/90">
        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="scrollbar-none flex min-w-0 flex-wrap items-center gap-2 overflow-x-auto lg:flex-nowrap">
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-outline-variant/10 bg-surface-container/70 p-1">
              <Button
                variant="primary"
                size="sm"
                loading={isExecuting}
                disabled={
                  !currentQuery.trim() ||
                  isExecuting ||
                  scaleSwitchMutation.isPending ||
                  resetSandboxMutation.isPending ||
                  !isSessionReady
                }
                onClick={() => executeQuery({ sessionId, sql: currentQuery })}
                leftIcon={
                  <span className="material-symbols-outlined text-[18px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                    play_arrow
                  </span>
                }
              >
                Run
              </Button>
              <Button
                variant="secondary"
                size="sm"
                loading={isExplaining}
                disabled={
                  !currentQuery.trim() ||
                  !explainPlanMode ||
                  isExplaining ||
                  scaleSwitchMutation.isPending ||
                  resetSandboxMutation.isPending ||
                  !isSessionReady
                }
                onClick={() => explainQuery({ sessionId, sql: currentQuery })}
                title={
                  !explainPlanMode && currentQuery.trim()
                    ? 'Execution plan is available for SELECT/INSERT/UPDATE/DELETE statements'
                    : 'Generate an execution plan for the current query'
                }
                leftIcon={<span className="material-symbols-outlined text-[18px]">account_tree</span>}
              >
                Explain
              </Button>
              {session?.challengeVersionId ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={submitAttemptMutation.isPending}
                  disabled={
                    !latestSuccessfulExecution ||
                    !isSessionReady ||
                    scaleSwitchMutation.isPending ||
                    resetSandboxMutation.isPending ||
                    submitAttemptMutation.isPending
                  }
                  onClick={() => submitAttemptMutation.mutate()}
                  leftIcon={<span className="material-symbols-outlined text-[18px]">flag</span>}
                  title={
                    latestSuccessfulExecution
                      ? 'Submit the latest successful query execution for challenge scoring'
                      : 'Run a successful query first'
                  }
                >
                  Submit Attempt
                </Button>
              ) : null}
            </div>
            <DatasetScaleSelector
              selectedScale={selectedScale}
              sourceScale={sourceScale}
              sourceRowCount={sourceRowCount}
              databaseName={displayDatabaseName}
            />
          </div>

          <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
            {entryPath && entryLabel && (
              <Link
                href={entryPath}
                className="hidden items-center gap-1 rounded-full border border-outline-variant/15 bg-surface-container-high/60 px-2.5 py-1 text-[11px] font-medium text-on-surface-variant transition-colors hover:text-on-surface md:inline-flex"
              >
                <span className="material-symbols-outlined text-sm">arrow_back</span>
                {entryLabel}
              </Link>
            )}
            {lessonTitle && (
              <span className="hidden max-w-[14rem] truncate text-xs text-on-surface-variant md:block">
                {lessonTitle}
              </span>
            )}
            {session?.challengeVersionId && bestChallengeAttempt ? (
              <span className="hidden rounded-full border border-outline-variant/15 bg-surface-container-high/60 px-2.5 py-1 text-[11px] font-medium text-on-surface-variant lg:inline-flex">
                Best {bestChallengeAttempt.queryExecution.durationMs != null ? `${bestChallengeAttempt.queryExecution.durationMs} ms` : 'validated run'}
              </span>
            ) : null}
            {session?.challengeVersionId && latestChallengeAttempt?.evaluation?.feedbackText ? (
              <span className="hidden max-w-[18rem] truncate text-[11px] text-outline xl:block">
                {latestChallengeAttempt.evaluation.feedbackText}
              </span>
            ) : null}
            <div className="flex items-center gap-2 rounded-full border border-outline-variant/15 bg-surface-container-high/60 px-2.5 py-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-outline">Sandbox</span>
              <span
                className={cn(
                  'h-2 w-2 rounded-full',
                  effectiveSessionStatus === 'active'
                    ? 'bg-green-400 shadow-[0_0_8px_rgba(34,197,94,0.45)]'
                    : effectiveSessionStatus === 'provisioning'
                      ? 'animate-pulse bg-tertiary'
                      : 'bg-outline',
                )}
              />
              <span className="text-[11px] font-medium text-on-surface-variant">
                {effectiveSessionStatus === 'provisioning'
                  ? 'Provisioning'
                  : effectiveSessionStatus === 'active'
                    ? 'Ready'
                    : effectiveSessionStatus ?? '—'}
              </span>
            </div>
            <Button
              variant="destructive"
              size="sm"
              loading={endSessionMutation.isPending}
              disabled={!session || session.status === 'ended'}
              onClick={handleOpenEndSessionModal}
              title="Stop this sandbox and end the current session immediately"
              leftIcon={
                <span className="material-symbols-outlined text-base leading-none align-middle">
                  stop_circle
                </span>
              }
            >
              End Session
            </Button>
          </div>
        </div>
      </header>

      <EndSessionModal
        open={isEndSessionModalOpen}
        isPending={endSessionMutation.isPending}
        onCancel={handleCloseEndSessionModal}
        onConfirm={handleConfirmEndSession}
      />

      {/* ── Session expired / failed overlay ── */}
      {session && !['active', 'provisioning', 'paused'].includes(effectiveSessionStatus ?? session.status) && (
        <LabSessionExpired status={effectiveSessionStatus ?? session.status} />
      )}

      {/* ── Main split pane ── */}
      {isInteractiveSession && (
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {/* Left: Editor */}
        <div
          className="flex flex-col overflow-hidden"
          style={{ width: `${leftWidth}%` }}
        >
          <div className="flex min-w-0 items-center border-b border-outline-variant/10 bg-surface-container-low/70 px-2">
            <div className="mr-2 flex shrink-0 items-center gap-1.5 border-r border-outline-variant/10 px-3 py-2 text-on-surface-variant">
              <span className="material-symbols-outlined text-sm" style={{ fontVariationSettings: "'FILL' 1" }}>
                terminal
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">
                SQL
              </span>
            </div>
            <EditorTabsBar />
            <div className="shrink-0 flex items-center gap-1.5 px-2">
              <span className="font-mono text-[10px] text-outline">
                Ln {currentQuery.split('\n').length}
              </span>
              <kbd className="hidden rounded-md border border-outline-variant/20 bg-surface-container px-1.5 py-0.5 font-mono text-[10px] text-on-surface-variant sm:inline">
                Ctrl+Enter
              </kbd>
            </div>
          </div>
          <SqlEditorPanel
            sessionId={sessionId}
            schemaTables={sessionSchema?.tables}
            onFormat={handleFormatSql}
            onCopy={handleCopyQuery}
            onClear={handleClearEditor}
            notice={editorNotice}
          />
        </div>

        {/* Resize handle */}
        <div
          className="resize-handle flex-none bg-transparent hover:bg-outline/40 transition-colors cursor-col-resize"
          style={{ width: '4px' }}
          onMouseDown={handleResizeMouseDown}
        />

        {/* Right: Results */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div
            className="flex shrink-0 items-center gap-0 overflow-x-auto border-b border-outline-variant/10 bg-surface-container-low/90"
            role="tablist"
          >
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id as TabId)}
                className={cn(
                  'flex items-center gap-1.5 whitespace-nowrap px-4 py-2.5 font-body text-xs font-medium transition-colors',
                  activeTab === tab.id
                    ? 'border-b-2 border-primary text-on-surface bg-surface-container-high/80'
                    : 'border-b-2 border-transparent text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
                )}
              >
                <span className="material-symbols-outlined text-base opacity-90">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
            {activeTab === 'results' && results && (
              <button
                type="button"
                onClick={() => {
                  const header = results.columns.map((c) => c.name).join(',');
                  const rows = results.rows.map((row) =>
                    results.columns.map((c) => JSON.stringify(row[c.name] ?? '')).join(','),
                  );
                  navigator.clipboard
                    .writeText([header, ...rows].join('\n'))
                    .then(() => toast.success('Đã copy kết quả (CSV)'));
                }}
                className="ml-auto mr-2 flex items-center gap-1 rounded px-2 py-1 text-[11px] text-on-surface-variant hover:bg-surface-container hover:text-on-surface transition-colors"
                title="Copy results as CSV"
              >
                <span className="material-symbols-outlined text-sm">content_copy</span>
                CSV
              </button>
            )}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {activeTab === 'results' && <ResultsPanel />}
            {activeTab === 'plan' && <ExecutionPlanPanel />}
            {activeTab === 'compare' && (
              <SideBySideComparePanel
                queryHistory={queryHistory}
                challengeVersionId={session?.challengeVersionId ?? null}
              />
            )}
            {activeTab === 'history' && <QueryHistoryPanel sessionId={sessionId} />}
            {activeTab === 'schema' && (
              <div ref={schemaContainerRef} className="flex flex-1 min-h-0 flex-col overflow-hidden">
                <div
                  className="min-h-0 overflow-hidden"
                  style={{ height: `${schemaTopHeight}%` }}
                >
                  <SchemaPanel sessionId={sessionId} />
                </div>
                <div
                  className="group relative h-2 shrink-0 cursor-row-resize bg-surface-container-low transition-colors hover:bg-surface-container-high"
                  onMouseDown={handleSchemaResizeMouseDown}
                />
                <div
                  className="min-h-0 overflow-hidden"
                  style={{ height: `${100 - schemaTopHeight}%` }}
                >
                  <SchemaDiffPanel
                    sessionId={sessionId}
                    onReset={() => resetSandboxMutation.mutate()}
                    isResetting={resetSandboxMutation.isPending}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {/* ── Status bar ── */}
      <div className="flex h-7 shrink-0 items-center justify-between border-t border-outline-variant/10 bg-surface-container-low px-4 text-[10px]">
        {/* Left: system metrics */}
        <div className="flex items-center gap-3">
          {/* Connection indicator */}
          <div className="flex items-center gap-1.5">
            <div
              className={cn(
                'w-1.5 h-1.5 rounded-full',
                effectiveSessionStatus === 'active'
                  ? 'bg-green-400'
                  : effectiveSessionStatus === 'provisioning'
                  ? 'bg-on-surface-variant/70 animate-pulse'
                  : 'bg-outline'
              )}
            />
            <span className="text-[9px] font-bold uppercase text-outline tracking-widest">
              {effectiveSessionStatus === 'active'
                ? 'Connected'
                : effectiveSessionStatus === 'provisioning'
                ? 'Provisioning'
                : 'Offline'}
            </span>
          </div>

          <div className="h-3 w-px bg-outline-variant/20" />

          {/* CPU meter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-bold text-outline uppercase">CPU</span>
            <div className="w-12 h-1 bg-surface-container-highest rounded-full overflow-hidden">
              <div className="w-[24%] h-full bg-on-surface-variant rounded-full" />
            </div>
          </div>

          {/* MEM meter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] font-bold text-outline uppercase">MEM</span>
            <div className="w-12 h-1 bg-surface-container-highest rounded-full overflow-hidden">
              <div className="w-[41%] h-full bg-outline rounded-full" />
            </div>
          </div>

          <div className="h-3 w-px bg-outline-variant/20" />

          {/* Query stats */}
          {lastExecution?.durationMs !== undefined && (
            <span className="text-[9px] text-outline font-mono">
              {formatDuration(lastExecution.durationMs)}
            </span>
          )}
          {results && (
            <span className="text-[9px] text-outline font-mono">
              {formatRows(results.totalRows)} rows
              {results.truncated && ' (truncated)'}
            </span>
          )}
          {error && (
            <span className="text-[9px] text-error font-mono truncate max-w-[200px]">
              {error.slice(0, 50)}{error.length > 50 ? '…' : ''}
            </span>
          )}
        </div>

        {/* Right: encoding + session ID */}
        <div className="flex items-center gap-3">
          <span className="text-[9px] text-outline uppercase tracking-widest">UTF-8</span>
          <div className="h-3 w-px bg-outline-variant/20" />
          <span className="text-[9px] text-outline font-mono">
            {sessionId.length > 0 ? `${sessionId.slice(0, 8)}…` : '—'}
          </span>
        </div>
      </div>
    </div>
  );
}
