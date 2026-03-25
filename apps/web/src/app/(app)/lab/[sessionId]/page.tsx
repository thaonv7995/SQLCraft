'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLabStore } from '@/stores/lab';
import toast from 'react-hot-toast';
import {
  useExecuteQuery,
  useExplainQuery,
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
  lessonsApi,
  queryApi,
  sandboxesApi,
  type DatasetScale,
  type QueryExecution,
  type QueryResultColumn,
  type SessionSchemaDiffResponse,
} from '@/lib/api';
import { SqlEditor } from '@/components/ui/sql-editor';
import { ExecutionPlanTree } from '@/components/lab/execution-plan-tree';
import { markLabBootstrapConsumed, readLabBootstrap } from '@/lib/lab-bootstrap';
import {
  createDefaultLabEditorState,
  readLabEditorState,
  writeLabEditorState,
  type LabEditorTab,
} from '@/lib/lab-editor-tabs';

function sessionIdFromParams(params: { sessionId?: string | string[] }): string {
  const raw = params.sessionId;
  if (typeof raw === 'string' && raw.length > 0) {
    return decodeURIComponent(raw);
  }
  if (Array.isArray(raw) && raw[0]) {
    return decodeURIComponent(raw[0]);
  }
  return '';
}

const COMPARE_TERMINAL_STATUSES = new Set<QueryExecution['status']>(['success', 'error']);
const COMPARE_POLL_INTERVAL_MS = 600;
const COMPARE_POLL_TIMEOUT_MS = 35_000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function runQueryUntilSettled(payload: {
  sessionId: string;
  sql: string;
}): Promise<QueryExecution> {
  const accepted = await queryApi.execute(payload);

  if (COMPARE_TERMINAL_STATUSES.has(accepted.status)) {
    return accepted;
  }

  const deadline = Date.now() + COMPARE_POLL_TIMEOUT_MS;

  while (true) {
    const execution = await queryApi.poll(accepted.id);

    if (COMPARE_TERMINAL_STATUSES.has(execution.status)) {
      return execution;
    }

    if (Date.now() > deadline) {
      throw new Error(`Comparison timed out after ${COMPARE_POLL_TIMEOUT_MS / 1000}s`);
    }

    await sleep(COMPARE_POLL_INTERVAL_MS);
  }
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
  availableScales,
  isSwitching,
  sessionStatus,
  onChange,
}: {
  selectedScale: DatasetScale | null;
  sourceScale: DatasetScale | null;
  sourceRowCount: number | null;
  availableScales: DatasetScale[];
  isSwitching: boolean;
  sessionStatus?: string | null;
  onChange: (scale: DatasetScale) => void;
}) {
  const scales = availableScales.length > 0 ? availableScales : (Object.keys(DATASET_SCALE_META) as DatasetScale[]);
  const isDisabled = sessionStatus !== 'active' || isSwitching;
  const sourceScaleLabel = sourceScale ? DATASET_SCALE_META[sourceScale].label : 'Unknown';

  return (
    <div className="flex flex-col items-end gap-1">
      <div
        className="flex items-center gap-0.5 rounded-lg border border-outline-variant/10 bg-surface-container-low p-0.5"
        title="Changing scale reprovisions the sandbox from a prepared dataset artifact"
      >
        {scales.map((scale) => (
          <button
            key={scale}
            type="button"
            disabled={isDisabled}
            onClick={() => onChange(scale)}
            className={cn(
              'rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              selectedScale === scale
                ? 'bg-surface-container-high text-on-surface shadow-sm'
                : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
            )}
            title={DATASET_SCALE_META[scale].desc}
          >
            {DATASET_SCALE_META[scale].label}
          </button>
        ))}
      </div>
      <p className="text-[10px] text-outline">
        Source {sourceScaleLabel}
        {typeof sourceRowCount === 'number' ? ` (${formatRows(sourceRowCount)} rows)` : ''}
        {selectedScale ? ` · Selected ${DATASET_SCALE_META[selectedScale].label}` : ''}
      </p>
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
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [draftTabName, setDraftTabName] = useState('');

  useEffect(() => {
    if (editingTabId && !editorTabs.some((tab) => tab.id === editingTabId)) {
      setEditingTabId(null);
      setDraftTabName('');
    }
  }, [editingTabId, editorTabs]);

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

  return (
    <div className="flex min-w-0 flex-1 items-stretch overflow-hidden">
      <div className="scrollbar-none flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {editorTabs.map((tab) => {
          const isActive = tab.id === activeEditorTabId;
          const isEditing = tab.id === editingTabId;
          const canClose = editorTabs.length > 1;

          return (
            <div
              key={tab.id}
              className={cn(
                'group flex shrink-0 items-center gap-1 border-r border-outline-variant/10 px-2 py-2 transition-colors',
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
                  {canClose ? (
                    <button
                      type="button"
                      onClick={() => closeEditorTab(tab.id)}
                      className="rounded p-0.5 text-outline transition-colors hover:text-on-surface"
                      title="Close tab"
                      aria-label={`Close ${tab.name}`}
                    >
                      <span className="material-symbols-outlined text-sm">close</span>
                    </button>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
      </div>

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
  );
}

function SqlEditorPanel({
  onFormat,
  onCopy,
}: {
  onFormat: () => void;
  onCopy: () => void;
}) {
  const currentQuery = useLabStore((state) => state.currentQuery);
  const setQuery = useLabStore((state) => state.setQuery);
  const params = useParams<{ sessionId?: string | string[] }>();
  const sessionId = sessionIdFromParams(params);
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
                  <div className="flex flex-col gap-0.5">
                    <span>{col.name}</span>
                    <span className="text-outline font-normal normal-case tracking-normal">
                      {col.dataType}
                    </span>
                  </div>
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
    <div className="flex-1 overflow-auto p-4">
      <ExecutionPlanTree executionPlan={executionPlan} queryDurationMs={lastExecution?.durationMs} />
    </div>
  );
}

// ─── Query History Panel ──────────────────────────────────────────────────────

function QueryHistoryPanel() {
  const { queryHistory, setQuery } = useLabStore();

  if (queryHistory.length === 0) {
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
      {queryHistory.map((q) => (
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
    <div className="flex-1 overflow-y-auto p-3 space-y-1">
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

function CompareExecutionCard({
  label,
  query,
  execution,
}: {
  label: string;
  query: string;
  execution: QueryExecution | null;
}) {
  const previewRows = execution?.result?.rows.slice(0, 5) ?? [];
  const previewColumns = execution?.result?.columns ?? [];

  return (
    <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low/70 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
            {label}
          </p>
          <p className="mt-1 text-xs text-on-surface-variant">
            {query.trim() ? truncateSql(query, 120) : 'No query yet'}
          </p>
        </div>
        {execution ? <StatusBadge status={execution.status} /> : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-on-surface-variant">
        {execution?.durationMs != null ? (
          <span className="rounded-full bg-surface-container-high px-2 py-1">
            {execution.durationMs} ms
          </span>
        ) : null}
        {execution?.rowCount != null ? (
          <span className="rounded-full bg-surface-container-high px-2 py-1">
            {execution.rowCount} rows
          </span>
        ) : null}
        {execution?.executionPlan?.actualTime != null ? (
          <span className="rounded-full bg-surface-container-high px-2 py-1">
            plan {Math.round(execution.executionPlan.actualTime)} ms
          </span>
        ) : null}
        {execution?.executionPlan?.totalCost != null ? (
          <span className="rounded-full bg-surface-container-high px-2 py-1">
            cost {Math.round(execution.executionPlan.totalCost)}
          </span>
        ) : null}
      </div>

      {execution?.errorMessage ? (
        <div className="mt-3 rounded-xl border border-error/20 bg-error/10 px-3 py-3 text-xs text-error">
          {execution.errorMessage}
        </div>
      ) : null}

      {!execution ? (
        <div className="mt-3 rounded-xl border border-dashed border-outline-variant/20 px-3 py-4 text-xs text-on-surface-variant">
          Run the comparison to capture duration, row count, and plan metrics for this variant.
        </div>
      ) : null}

      {execution?.result ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-outline-variant/10">
          <div className="overflow-auto">
            <Table stickyHeader>
              <TableHeader>
                <TableRow>
                  {previewColumns.map((column) => (
                    <TableHead key={column.name}>{column.name}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {previewRows.length === 0 ? (
                  <TableEmpty
                    message="Query returned no rows"
                    colSpan={Math.max(1, previewColumns.length)}
                  />
                ) : (
                  previewRows.map((row, index) => (
                    <TableRow key={`${label}-${index}`}>
                      {previewColumns.map((column) => (
                        <TableCell key={column.name} className="font-mono text-xs">
                          {row[column.name] == null ? (
                            <span className="text-outline italic">NULL</span>
                          ) : (
                            String(row[column.name])
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          {execution.result.totalRows > previewRows.length ? (
            <div className="border-t border-outline-variant/10 bg-surface-container-low px-3 py-2 text-[11px] text-outline">
              Previewing {previewRows.length} of {execution.result.totalRows} rows
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SideBySideComparePanel({
  sessionId,
  primaryQuery,
}: {
  sessionId: string;
  primaryQuery: string;
}) {
  const queryClient = useQueryClient();
  const [secondaryQuery, setSecondaryQuery] = useState('');
  const [primaryExecution, setPrimaryExecution] = useState<QueryExecution | null>(null);
  const [secondaryExecution, setSecondaryExecution] = useState<QueryExecution | null>(null);

  const compareMutation = useMutation({
    mutationFn: async () => {
      const [primary, secondary] = await Promise.all([
        runQueryUntilSettled({ sessionId, sql: primaryQuery }),
        runQueryUntilSettled({ sessionId, sql: secondaryQuery }),
      ]);

      return { primary, secondary };
    },
    onSuccess: ({ primary, secondary }) => {
      setPrimaryExecution(primary);
      setSecondaryExecution(secondary);
      useLabStore.setState((state) => ({
        queryHistory: [secondary, primary, ...state.queryHistory].slice(0, 100),
      }));
      queryClient.invalidateQueries({ queryKey: ['query-history', sessionId] });

      if (primary.status === 'success' && secondary.status === 'success') {
        const faster =
          (primary.durationMs ?? Number.POSITIVE_INFINITY) <=
          (secondary.durationMs ?? Number.POSITIVE_INFINITY)
            ? 'Primary'
            : 'Compare';
        toast.success(`${faster} query finished faster in this run.`);
      } else {
        toast.error('At least one comparison query failed. Inspect both panes for details.');
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to compare queries');
    },
  });

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="space-y-4">
        <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low/70 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium text-on-surface">
                Run two variants against the same sandbox state
              </p>
              <p className="max-w-3xl text-sm leading-6 text-on-surface-variant">
                The primary query comes from the main editor on the left. Add a second variant here,
                then run both together to compare latency, row count, and plan metrics side-by-side.
                Index changes such as <code>CREATE INDEX</code> or <code>DROP INDEX</code> will show up in
                the Schema Diff tab and can be reverted by resetting the sandbox back to base.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!primaryQuery.trim()}
                onClick={() => setSecondaryQuery(primaryQuery)}
              >
                Copy current query
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={compareMutation.isPending}
                disabled={!primaryQuery.trim() || !secondaryQuery.trim()}
                onClick={() => compareMutation.mutate()}
              >
                Run Side-by-side
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <CompareExecutionCard
            label="Primary · Main editor query"
            query={primaryQuery}
            execution={primaryExecution}
          />

          <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low/70 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
                  Compare · Secondary query
                </p>
                <p className="mt-1 text-xs text-on-surface-variant">
                  Keep this variant isolated so you can test index-aware rewrites directly.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={!secondaryQuery.trim()}
                onClick={() => setSecondaryQuery('')}
              >
                Clear
              </Button>
            </div>

            <div className="mt-3 h-56 overflow-hidden rounded-xl border border-outline-variant/10">
              <SqlEditor
                value={secondaryQuery}
                onChange={setSecondaryQuery}
                placeholder="-- Variant B: rewrite, add hints via indexes, or compare plan choices"
              />
            </div>

            <div className="mt-4">
              <CompareExecutionCard
                label="Compare · Secondary result"
                query={secondaryQuery}
                execution={secondaryExecution}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SchemaDiffEntry({
  tone,
  title,
  subtitle,
  definition,
  previousDefinition,
}: {
  tone: 'added' | 'removed' | 'changed';
  title: string;
  subtitle?: string | null;
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
    <div className={cn('rounded-xl border px-3 py-3', toneClass)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-on-surface">{title}</p>
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-outline">
          {label}
        </span>
      </div>
      {subtitle ? (
        <p className="mt-1 text-xs text-on-surface-variant">{subtitle}</p>
      ) : null}
      {previousDefinition ? (
        <div className="mt-3 space-y-2 text-[11px]">
          <div>
            <p className="mb-1 uppercase tracking-[0.16em] text-outline">Base</p>
            <pre className="overflow-x-auto rounded-lg bg-surface-container-high px-3 py-2 font-mono text-outline">
              {previousDefinition}
            </pre>
          </div>
          <div>
            <p className="mb-1 uppercase tracking-[0.16em] text-outline">Current</p>
            <pre className="overflow-x-auto rounded-lg bg-surface-container-high px-3 py-2 font-mono text-on-surface-variant">
              {definition}
            </pre>
          </div>
        </div>
      ) : definition ? (
        <pre className="mt-3 overflow-x-auto rounded-lg bg-surface-container-high px-3 py-2 font-mono text-[11px] text-on-surface-variant">
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

  const renderSection = (
    title: string,
    icon: string,
    section:
      | SessionSchemaDiffResponse['indexes']
      | SessionSchemaDiffResponse['views']
      | SessionSchemaDiffResponse['materializedViews']
      | SessionSchemaDiffResponse['functions']
      | SessionSchemaDiffResponse['partitions'],
    describe: (item: any) => { title: string; subtitle?: string | null; definition?: string | null },
    describeChanged?: (item: any) => { title: string; subtitle?: string | null; definition?: string | null },
  ) => {
    const changeCount = section.added.length + section.removed.length + section.changed.length;

    if (changeCount === 0) {
      return null;
    }

    return (
      <div key={title} className="rounded-2xl border border-outline-variant/10 bg-surface-container-low/70 p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-base text-tertiary">{icon}</span>
          <div>
            <p className="text-sm font-medium text-on-surface">{title}</p>
            <p className="text-[11px] text-outline">
              {changeCount} change{changeCount === 1 ? '' : 's'}
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {section.added.map((item) => {
            const formatted = describe(item);
            return (
              <SchemaDiffEntry
                key={`added-${formatted.title}`}
                tone="added"
                title={formatted.title}
                subtitle={formatted.subtitle}
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
          <p className="text-sm text-on-surface-variant">
            {error instanceof Error ? error.message : 'Unable to load schema diff'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="space-y-4">
        <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low/70 p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <p className="text-sm font-medium text-on-surface">Sandbox schema drift</p>
              <p className="max-w-3xl text-sm leading-6 text-on-surface-variant">
                This compares the live sandbox against the published base schema template. Use it
                to see indexes, views, materialized views, functions, and partitions that were
                added, removed, or changed while optimizing the lesson.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={isResetting}
              onClick={onReset}
            >
              Reset sandbox về base
            </Button>
          </div>
        </div>

        {!diff.hasChanges ? (
          <div className="rounded-2xl border border-dashed border-outline-variant/20 bg-surface-container-low px-4 py-8 text-center text-sm text-on-surface-variant">
            No drift detected. The sandbox still matches the published base definition.
          </div>
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {renderSection(
              'Indexes',
              'database',
              diff.indexes,
              (item) => ({
                title: item.name,
                subtitle: `Table ${item.tableName}`,
                definition: item.definition,
              }),
            )}
            {renderSection(
              'Views',
              'preview',
              diff.views,
              (item) => ({
                title: item.name,
                definition: item.definition,
              }),
            )}
            {renderSection(
              'Materialized Views',
              'inventory_2',
              diff.materializedViews,
              (item) => ({
                title: item.name,
                definition: item.definition,
              }),
            )}
            {renderSection(
              'Functions',
              'code_blocks',
              diff.functions,
              (item) => ({
                title: `${item.name}(${item.signature})`,
                subtitle: item.language ? `Language ${item.language}` : null,
                definition: item.definition,
              }),
            )}
            {renderSection(
              'Partitions',
              'splitscreen',
              diff.partitions,
              (item) => ({
                title: item.name,
                subtitle: `${item.parentTable}${item.strategy ? ` · ${item.strategy}` : ''}`,
                definition: item.definition ?? null,
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
  { id: 'schemaDiff', label: 'Schema Diff', icon: 'difference' },
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
  const params = useParams<{ sessionId?: string | string[] }>();
  const sessionId = sessionIdFromParams(params);
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

  const {
    data: session,
    isLoading: sessionLoading,
    isError: sessionError,
    error: sessionFetchError,
    refetch: refetchSession,
  } = useSessionStatus(sessionId);
  const lessonContext = useMemo(() => readLabBootstrap(sessionId), [sessionId]);
  const { data: sessionLessonVersion } = useQuery({
    queryKey: ['lab-session-lesson-version', session?.lessonVersionId],
    queryFn: () => lessonsApi.getVersion(session!.lessonVersionId),
    enabled: Boolean(session?.lessonVersionId),
    staleTime: 60_000,
  });
  const { data: challengeAttempts = [] } = useQuery({
    queryKey: ['challenge-attempts', session?.challengeVersionId],
    queryFn: () => challengesApi.listAttempts(session!.challengeVersionId!),
    enabled: Boolean(session?.challengeVersionId),
    staleTime: 15_000,
  });
  const fallbackLessonPath = sessionLessonVersion?.lesson?.trackId
    ? `/tracks/${sessionLessonVersion.lesson.trackId}/lessons/${sessionLessonVersion.lessonId}`
    : null;
  const fallbackChallenge = session?.challengeVersionId
    ? sessionLessonVersion?.challenges.find(
        (challenge) => challenge.publishedVersionId === session.challengeVersionId,
      ) ?? null
    : null;
  const fallbackChallengePath =
    fallbackLessonPath && fallbackChallenge
      ? `${fallbackLessonPath}/challenges/${fallbackChallenge.id}`
      : null;
  const entryPath =
    lessonContext?.challengePath ??
    lessonContext?.lessonPath ??
    fallbackChallengePath ??
    fallbackLessonPath;
  const entryLabel = lessonContext?.challengePath || fallbackChallengePath
    ? 'Back to challenge'
    : entryPath
      ? 'Back to lesson'
      : null;
  const modeLabel =
    lessonContext?.mode === 'challenge' || session?.challengeVersionId ? 'Challenge' : 'Lesson';
  const lessonTitle = session?.lessonTitle ?? lessonContext?.lessonTitle ?? sessionLessonVersion?.lesson?.title;
  const challengeTitle = lessonContext?.challengeTitle ?? fallbackChallenge?.title;
  const latestSuccessfulExecution =
    queryHistory.find((execution) => execution.status === 'success') ?? null;
  const bestChallengeAttempt = challengeAttempts.reduce<(typeof challengeAttempts)[number] | null>(
    (best, attempt) => {
      if (!best) {
        return attempt;
      }

      return (attempt.score ?? -1) > (best.score ?? -1) ? attempt : best;
    },
    null,
  );
  const latestChallengeAttempt = challengeAttempts[0] ?? null;
  const explainPlanMode = getExplainPlanMode(currentQuery);
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
        challengeVersionId: session.challengeVersionId,
        queryExecutionId: latestSuccessfulExecution.id,
      });
    },
    onSuccess: (attempt) => {
      queryClient.invalidateQueries({
        queryKey: ['challenge-attempts', session?.challengeVersionId],
      });
      const feedback = attempt.evaluation?.feedbackText;
      toast.success(
        feedback
          ? `Attempt scored ${attempt.score ?? 0} pts. ${feedback}`
          : `Attempt scored ${attempt.score ?? 0} pts.`,
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

  const [hydratedEditorSessionId, setHydratedEditorSessionId] = useState<string | null>(null);
  const [hasPersistedEditorTabs, setHasPersistedEditorTabs] = useState(false);

  useEffect(() => {
    if (!sessionId) {
      setHydratedEditorSessionId(null);
      setHasPersistedEditorTabs(false);
      return;
    }

    const persistedEditorState = readLabEditorState(sessionId);
    setHasPersistedEditorTabs(Boolean(persistedEditorState));

    if (persistedEditorState) {
      hydrateEditorTabs(persistedEditorState.tabs, persistedEditorState.activeTabId);
    } else {
      const defaultEditorState = createDefaultLabEditorState();
      hydrateEditorTabs(defaultEditorState.tabs, defaultEditorState.activeTabId);
    }

    setHydratedEditorSessionId(sessionId);
  }, [hydrateEditorTabs, sessionId]);

  useEffect(() => {
    if (!sessionId || hydratedEditorSessionId !== sessionId) {
      return;
    }

    writeLabEditorState(sessionId, {
      tabs: editorTabs,
      activeTabId: activeEditorTabId,
    });
  }, [activeEditorTabId, editorTabs, hydratedEditorSessionId, sessionId]);

  useEffect(() => {
    if (!sessionId || hydratedEditorSessionId !== sessionId) {
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
  }, [hasPersistedEditorTabs, hydratedEditorSessionId, sessionId, setQuery]);

  // Global keyboard shortcut: Ctrl+Enter to execute (must run before any conditional return — Rules of Hooks)
  useEffect(() => {
    if (!sessionId) return;
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
  }, [sessionId, currentQuery, isExecuting, executeQuery]);

  const [leftWidth, setLeftWidth] = useState(55); // percent
  const resizing = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  const handleFormatSql = useCallback(() => {
    try {
      setQuery(formatSqlInBrowser(currentQuery));
      toast.success('Đã format SQL');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Không format được SQL');
    }
  }, [currentQuery, setQuery]);

  const handleCopyQuery = useCallback(() => {
    navigator.clipboard.writeText(currentQuery).then(() => toast.success('Đã copy query'));
  }, [currentQuery]);

  const handleClearEditor = useCallback(() => {
    setQuery('');
    useLabStore.getState().resetResults();
  }, [setQuery]);
  const handleScaleChange = useCallback(
    (nextScale: DatasetScale) => {
      if (!session || session.status !== 'active' || scaleSwitchMutation.isPending) {
        return;
      }

      if (selectedScale === nextScale) {
        return;
      }

      scaleSwitchMutation.mutate(nextScale);
    },
    [scaleSwitchMutation, selectedScale, session],
  );

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
          <div className="scrollbar-none flex min-w-0 flex-wrap items-center gap-2 overflow-x-auto">
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
                  session?.status !== 'active'
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
                  session?.status !== 'active'
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
              <Button
                variant="ghost"
                size="sm"
                disabled={!currentQuery.trim()}
                onClick={handleClearEditor}
                title="Clear editor and results"
                leftIcon={<span className="material-symbols-outlined text-[18px]">delete_sweep</span>}
              >
                Clear
              </Button>
              {session?.challengeVersionId ? (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={submitAttemptMutation.isPending}
                  disabled={
                    !latestSuccessfulExecution ||
                    session?.status === 'provisioning' ||
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
              availableScales={availableScales}
              isSwitching={scaleSwitchMutation.isPending}
              sessionStatus={session?.status}
              onChange={handleScaleChange}
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
            <span className="hidden rounded-full border border-outline-variant/15 bg-surface-container-high/60 px-2.5 py-1 text-[11px] font-medium text-on-surface-variant md:inline-flex">
              {modeLabel}
            </span>
            {lessonTitle && (
              <span className="hidden max-w-[14rem] truncate text-xs text-on-surface-variant md:block">
                {lessonTitle}
              </span>
            )}
            {challengeTitle && (
              <span className="hidden max-w-[14rem] truncate text-xs text-outline lg:block">
                {challengeTitle}
              </span>
            )}
            {session?.challengeVersionId && bestChallengeAttempt ? (
              <span className="hidden rounded-full border border-outline-variant/15 bg-surface-container-high/60 px-2.5 py-1 text-[11px] font-medium text-on-surface-variant lg:inline-flex">
                Best {bestChallengeAttempt.score ?? 0} pts
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
                  session?.status === 'active'
                    ? 'bg-secondary shadow-[0_0_8px_rgba(255,255,255,0.15)]'
                    : session?.status === 'provisioning'
                      ? 'animate-pulse bg-tertiary'
                      : 'bg-outline',
                )}
              />
              <span className="text-[11px] font-medium text-on-surface-variant">
                {session?.status === 'provisioning'
                  ? 'Provisioning'
                  : session?.status === 'active'
                    ? 'Ready'
                    : session?.status ?? '—'}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* ── Session expired / failed overlay ── */}
      {session && !['active', 'provisioning', 'paused'].includes(session.status) && (
        <LabSessionExpired status={session.status} />
      )}

      {/* ── Main split pane ── */}
      {(!session || ['active', 'provisioning', 'paused'].includes(session.status)) && (
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {/* Left: Editor */}
        <div
          className="flex flex-col overflow-hidden"
          style={{ width: `${leftWidth}%` }}
        >
          <div className="flex items-center border-b border-outline-variant/10 bg-surface-container-low/80">
            <div className="flex shrink-0 items-center gap-2 border-r border-outline-variant/10 bg-surface-container px-4 py-2">
              <span className="material-symbols-outlined text-base text-tertiary" style={{ fontVariationSettings: "'FILL' 1" }}>
                terminal
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-outline">
                SQL
              </span>
            </div>
            <EditorTabsBar />
            <div className="ml-auto flex items-center gap-2 px-3">
              <span className="hidden max-w-40 truncate font-mono text-[10px] uppercase text-outline lg:inline">
                {currentEditorTabName}
              </span>
              <span className="font-mono text-[10px] uppercase text-outline">
                {currentQuery.split('\n').length} lines
              </span>
              <kbd className="hidden rounded border border-outline-variant/20 bg-surface-container px-1.5 py-0.5 font-mono text-[10px] text-on-surface-variant sm:inline">
                Ctrl+Enter
              </kbd>
            </div>
          </div>
          <SqlEditorPanel onFormat={handleFormatSql} onCopy={handleCopyQuery} />
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
              <SideBySideComparePanel sessionId={sessionId} primaryQuery={currentQuery} />
            )}
            {activeTab === 'history' && <QueryHistoryPanel />}
            {activeTab === 'schema' && <SchemaPanel sessionId={sessionId} />}
            {activeTab === 'schemaDiff' && (
              <SchemaDiffPanel
                sessionId={sessionId}
                onReset={() => resetSandboxMutation.mutate()}
                isResetting={resetSandboxMutation.isPending}
              />
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
                session?.status === 'active'
                  ? 'bg-on-surface-variant'
                  : session?.status === 'provisioning'
                  ? 'bg-on-surface-variant/70 animate-pulse'
                  : 'bg-outline'
              )}
            />
            <span className="text-[9px] font-bold uppercase text-outline tracking-widest">
              {session?.status === 'active'
                ? 'Connected'
                : session?.status === 'provisioning'
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
