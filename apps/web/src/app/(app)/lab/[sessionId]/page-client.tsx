'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import {
  cn,
  formatDuration,
  formatPlannerEstimatedCost,
  formatRows,
  formatRelativeTime,
  getExplainPlanMode,
  truncateSql,
} from '@/lib/utils';
import {
  challengesApi,
  sandboxesApi,
  sessionsApi,
  type RevertSessionSchemaChangePayload,
  type DatasetScale,
  type LearningSession,
  type QueryExecution,
  type QueryResultColumn,
  type SessionProvisioningEstimate,
  type SessionSchemaDiffResponse,
  type SessionSchemaDiffSection,
  type SessionSchemaTable,
} from '@/lib/api';
import { useAuthStore } from '@/stores/auth';
import { SqlEditor } from '@/components/ui/sql-editor';
import { ChallengeAttemptCriteriaChecks } from '@/components/lab/challenge-attempt-criteria-checks';
import { ExecutionPlanTree } from '@/components/lab/execution-plan-tree';
import { markLabBootstrapConsumed, readLabBootstrap } from '@/lib/lab-bootstrap';
import {
  createDefaultLabEditorState,
  readLabEditorState,
  writeLabEditorState,
  type LabEditorTab,
} from '@/lib/lab-editor-tabs';
import type { ClientPageProps } from '@/lib/page-props';
import { DATASET_SCALE_DISPLAY_META } from '@/lib/database-catalog';

/** API appends ` OK: [type] …` per criterion after the main verdict; cards already show those lines. */
function extractPrimaryChallengeFeedback(text: string | undefined): string {
  if (!text?.trim()) return '';
  const idx = text.search(/\s+OK:\s*\[/);
  if (idx === -1) return text.trim();
  return text.slice(0, idx).trim();
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

/** Live remaining time from `estimatedReadyAt`, ticking once per second (see `tick` state). */
function useProvisioningRemainingSeconds(
  isProvisioning: boolean,
  estimate: SessionProvisioningEstimate | null | undefined,
): number | null {
  const fallbackAnchorRef = useRef<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!isProvisioning || !estimate) {
      fallbackAnchorRef.current = null;
      return;
    }
    const readyMs = Date.parse(estimate.estimatedReadyAt);
    if (!Number.isFinite(readyMs) && fallbackAnchorRef.current == null) {
      fallbackAnchorRef.current = Date.now();
    }
  }, [isProvisioning, estimate?.estimatedReadyAt, estimate?.estimatedSeconds]);

  useEffect(() => {
    if (!isProvisioning || !estimate) {
      return;
    }
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [isProvisioning, estimate?.estimatedReadyAt, estimate?.estimatedSeconds]);

  const readyAt = estimate?.estimatedReadyAt;
  const totalSec = estimate?.estimatedSeconds;

  return useMemo(() => {
    if (!isProvisioning || !estimate) return null;
    const readyMs = Date.parse(estimate.estimatedReadyAt);
    if (Number.isFinite(readyMs)) {
      return Math.max(0, (readyMs - Date.now()) / 1000);
    }
    const anchor = fallbackAnchorRef.current;
    const total = estimate.estimatedSeconds;
    if (!Number.isFinite(total) || total < 1) return 0;
    if (anchor == null) return total;
    const elapsed = (Date.now() - anchor) / 1000;
    return Math.max(0, total - elapsed);
  }, [isProvisioning, estimate, readyAt, totalSec, tick]);
}

/** Shown when ETA elapsed but session is still provisioning (DB often up; dataset restore may continue). */
const PROVISIONING_PAST_ETA_LABEL = 'Loading data…';

function formatProvisioningRemaining(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return PROVISIONING_PAST_ETA_LABEL;
  if (seconds < 90) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  if (s >= 60) return `${m + 1}m 00s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

// ─── Dataset Scale Selector ───────────────────────────────────────────────────

function formatSandboxDialect(dialect: string | null | undefined): string {
  if (dialect == null || !String(dialect).trim()) return 'N/A';
  const key = String(dialect).toLowerCase().trim();
  const labels: Record<string, string> = {
    postgresql: 'PostgreSQL',
    postgres: 'PostgreSQL',
    mysql: 'MySQL',
    mariadb: 'MariaDB',
    mssql: 'SQL Server',
    sqlserver: 'SQL Server',
    sqlite: 'SQLite',
  };
  return labels[key] ?? key;
}

function DatasetScaleSelector({
  selectedScale,
  sourceScale,
  sourceRowCount,
  databaseName,
  dialect,
}: {
  selectedScale: DatasetScale | null;
  sourceScale: DatasetScale | null;
  sourceRowCount: number | null;
  databaseName?: string | null;
  dialect?: string | null;
}) {
  const sourceScaleLabel = sourceScale ? DATASET_SCALE_DISPLAY_META[sourceScale].label : null;
  const sourceSummary =
    typeof sourceRowCount === 'number'
      ? `${formatRows(sourceRowCount)} rows`
      : sourceScaleLabel ?? 'Unknown';

  const dialectLabel = formatSandboxDialect(dialect);
  const hintText = `DB ${databaseName ?? 'N/A'} · Dialect ${dialectLabel} · Source ${sourceSummary}${
    sourceScaleLabel && typeof sourceRowCount === 'number' ? ` (${sourceScaleLabel})` : ''
  }${selectedScale ? ` · Scale ${DATASET_SCALE_DISPLAY_META[selectedScale].label}` : ''}`;

  return (
    <div
      className="inline-flex h-9 max-w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-outline-variant/10 bg-surface-container-low px-3 py-1 sm:gap-2 sm:py-0"
      title={hintText}
      aria-label={hintText}
    >
      <span className="text-[10px] uppercase tracking-[0.14em] text-outline">DB</span>
      <span className="max-w-[120px] truncate text-xs font-medium text-on-surface-variant">
        {databaseName ?? 'N/A'}
      </span>
      <span className="text-outline">•</span>
      <span className="text-[10px] uppercase tracking-[0.14em] text-outline">Dialect</span>
      <span className="rounded-md bg-surface-container-high px-2 py-1 text-xs font-medium text-on-surface">
        {dialectLabel}
      </span>
      <span className="text-outline">•</span>
      <span className="text-[10px] uppercase tracking-[0.14em] text-outline">Scale</span>
      <span className="rounded-md bg-surface-container-high px-2 py-1 text-xs font-medium text-on-surface">
        {selectedScale ? DATASET_SCALE_DISPLAY_META[selectedScale].label : 'N/A'}
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
  onDismissErrorNotice,
}: {
  sessionId: string;
  schemaTables?: SessionSchemaTable[];
  onFormat: () => void;
  onCopy: () => void;
  onClear: () => void;
  notice: 'success' | 'error' | 'info' | null;
  onDismissErrorNotice: () => void;
}) {
  const currentQuery = useLabStore((state) => state.currentQuery);
  const setQuery = useLabStore((state) => state.setQuery);
  const error = useLabStore((state) => state.error);
  const lastExecution = useLabStore((state) => state.lastExecution);
  const { mutate: executeQuery } = useExecuteQuery();

  const noticeMessage =
    notice === 'error'
      ? (error ?? lastExecution?.errorMessage ?? 'Query failed')
      : null;

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
      noticeMessage={noticeMessage}
      onDismissErrorNotice={onDismissErrorNotice}
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
              {results.columns.map((col: QueryResultColumn, colIndex) => (
                <TableHead key={colIndex}>
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
                  {results.columns.map((col, colIndex) => (
                    <TableCell key={colIndex} className="font-mono text-xs">
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
            Showing{' '}
            <span className="font-mono text-on-surface">{results.rows.length}</span>
            {' '}
            of{' '}
            <span className="font-mono text-on-surface">{results.totalRows.toLocaleString()}</span>
            {' '}rows — results are limited to the first 500 rows.
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
  const [sessionSnapshot, setSessionSnapshot] = useState(sessionId);
  if (sessionId !== sessionSnapshot) {
    setSessionSnapshot(sessionId);
    setPage(1);
  }
  const limit = 20;
  const historyQuery = useQueryHistory(sessionId, page, limit);
  const historyItems = historyQuery.data?.items ?? [];
  const totalPages = Math.max(1, historyQuery.data?.totalPages ?? 1);

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
          <p className="text-sm text-on-surface-variant">Could not load history</p>
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

function extractIndexFieldsFromDefinition(definition?: string | null): string[] {
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
}

function SchemaPanel({ sessionId }: { sessionId: string }) {
  const { data: schema, isLoading, isError } = useSessionSchema(sessionId);
  const { data: schemaDiff } = useSessionSchemaDiff(sessionId);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);

  const baseIndexFieldsByTable = useMemo(() => {
    const map = new Map<string, string[]>();
    const baseIndexes = schemaDiff?.indexes.base ?? [];
    for (const index of baseIndexes) {
      const fields = extractIndexFieldsFromDefinition(index.definition);
      if (fields.length === 0) continue;
      const existing = map.get(index.tableName) ?? [];
      const merged = Array.from(new Set([...existing, ...fields]));
      map.set(index.tableName, merged);
    }
    return map;
  }, [schemaDiff]);

  const addedIndexFieldsByTable = useMemo(() => {
    const map = new Map<string, string[]>();
    const addedIndexes = schemaDiff?.indexes.added ?? [];
    for (const index of addedIndexes) {
      const fields = extractIndexFieldsFromDefinition(index.definition);
      if (fields.length === 0) continue;
      const existing = map.get(index.tableName) ?? [];
      const merged = Array.from(new Set([...existing, ...fields]));
      map.set(index.tableName, merged);
    }
    return map;
  }, [schemaDiff]);

  const removedIndexFieldsByTable = useMemo(() => {
    const map = new Map<string, string[]>();
    const removedIndexes = schemaDiff?.indexes.removed ?? [];
    for (const index of removedIndexes) {
      const fields = extractIndexFieldsFromDefinition(index.definition);
      if (fields.length === 0) continue;
      const existing = map.get(index.tableName) ?? [];
      const merged = Array.from(new Set([...existing, ...fields]));
      map.set(index.tableName, merged);
    }
    return map;
  }, [schemaDiff]);

  const basePartitionsByParentTable = useMemo(() => {
    const map = new Map<string, string[]>();
    const basePartitions = schemaDiff?.partitions.base ?? [];
    for (const partition of basePartitions) {
      const existing = map.get(partition.parentTable) ?? [];
      map.set(partition.parentTable, [...existing, partition.name]);
    }
    return map;
  }, [schemaDiff]);

  const removedPartitionsByParentTable = useMemo(() => {
    const map = new Map<string, string[]>();
    const removedPartitions = schemaDiff?.partitions.removed ?? [];
    for (const partition of removedPartitions) {
      const existing = map.get(partition.parentTable) ?? [];
      map.set(partition.parentTable, [...existing, partition.name]);
    }
    return map;
  }, [schemaDiff]);

  const addedPartitionsByParentTable = useMemo(() => {
    const map = new Map<string, string[]>();
    const addedPartitions = schemaDiff?.partitions.added ?? [];
    for (const partition of addedPartitions) {
      const existing = map.get(partition.parentTable) ?? [];
      map.set(partition.parentTable, [...existing, partition.name]);
    }
    return map;
  }, [schemaDiff]);

  if (isLoading) return <SchemaPanelSkeleton />;

  if (isError || !schema) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <span className="material-symbols-outlined text-3xl text-outline block">error</span>
          <p className="text-xs text-on-surface-variant">Could not load schema</p>
        </div>
      </div>
    );
  }

  if (schema.tables.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-xs text-on-surface-variant">No tables in schema</p>
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
        const indexedFields = baseIndexFieldsByTable.get(table.name) ?? [];
        const addedIndexedFields = addedIndexFieldsByTable.get(table.name) ?? [];
        const removedIndexedFields = removedIndexFieldsByTable.get(table.name) ?? [];
        const indexedFieldSet = new Set(indexedFields);
        const addedIndexedFieldSet = new Set(addedIndexedFields);
        const removedIndexedFieldSet = new Set(removedIndexedFields);
        const partitionNames = basePartitionsByParentTable.get(table.name) ?? [];
        const addedPartitionNames = addedPartitionsByParentTable.get(table.name) ?? [];
        const removedPartitionNames = removedPartitionsByParentTable.get(table.name) ?? [];
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
              {partitionNames.length > 0 ? (
                <span className="inline-flex h-4 items-center rounded-[10px] border border-outline-variant/10 bg-surface-container-high px-1 py-0 text-[9px] font-semibold uppercase tracking-[0.04em] text-on-surface-variant">
                  part:{partitionNames.length}
                </span>
              ) : null}
              {addedPartitionNames.length > 0 ? (
                <button
                  type="button"
                  className="inline-flex h-4 items-center rounded-[10px] border border-blue-400/45 bg-blue-500/20 px-1 py-0 text-[9px] font-semibold uppercase tracking-[0.04em] text-blue-200 hover:bg-blue-500/25"
                  title="Open table to see new partition details"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setExpandedTable(table.name);
                  }}
                >
                  +part:{addedPartitionNames.length}
                </button>
              ) : null}
              {removedPartitionNames.length > 0 ? (
                <button
                  type="button"
                  className="inline-flex h-4 items-center rounded-[10px] border border-error/35 bg-error/20 px-1 py-0 text-[9px] font-semibold uppercase tracking-[0.04em] text-error hover:bg-error/25"
                  title="Open table to see removed partition details"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setExpandedTable(table.name);
                  }}
                >
                  -part:{removedPartitionNames.length}
                </button>
              ) : null}
              {table.rowCount != null && Number.isFinite(table.rowCount) ? (
                <span
                  className="ml-auto shrink-0 inline-flex items-center rounded-md border border-outline-variant/15 bg-surface-container-highest px-1.5 py-0.5 text-[10px] font-mono tabular-nums text-on-surface-variant/75"
                  title="Target rows (dataset template)"
                >
                  {formatRows(table.rowCount)}
                </span>
              ) : null}
            </button>
            {isExpanded && (
              <div className="ml-8 space-y-0.5 pb-2">
                {table.columns.map((col) => {
                  const idxBadge = addedIndexedFieldSet.has(col.name) ? (
                    <span className="inline-flex h-4 items-center rounded-[10px] border border-blue-400/45 bg-blue-500/20 px-1 py-0 text-[9px] font-semibold uppercase tracking-[0.04em] text-blue-200">
                      idx
                    </span>
                  ) : removedIndexedFieldSet.has(col.name) ? (
                    <span className="inline-flex h-4 items-center rounded-[10px] border border-error/35 bg-error/20 px-1 py-0 text-[9px] font-semibold uppercase tracking-[0.04em] text-error">
                      -idx
                    </span>
                  ) : indexedFieldSet.has(col.name) ? (
                    <span className="inline-flex h-4 items-center rounded-[10px] border border-outline-variant/10 bg-surface-container-high px-1 py-0 text-[9px] font-semibold uppercase tracking-[0.04em] text-on-surface-variant">
                      idx
                    </span>
                  ) : null;
                  const colTooltip = [
                    `${col.name}: ${col.type}`,
                    col.isPrimary ? 'PRIMARY KEY' : null,
                    col.isForeign ? 'FOREIGN KEY' : null,
                    col.references ? `→ ${col.references}` : null,
                    indexedFieldSet.has(col.name) || addedIndexedFieldSet.has(col.name)
                      ? 'Indexed'
                      : removedIndexedFieldSet.has(col.name)
                        ? 'Index removed (diff)'
                        : null,
                  ]
                    .filter(Boolean)
                    .join(' · ');
                  return (
                    <div
                      key={col.name}
                      className="rounded px-3 py-1.5 hover:bg-surface-container transition-colors"
                      title={colTooltip}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className={cn(
                            'material-symbols-outlined text-sm shrink-0 mt-0.5',
                            col.isPrimary ? 'text-primary' : col.isForeign ? 'text-secondary' : 'text-outline'
                          )}
                          style={{ fontVariationSettings: "'FILL' 1" }}
                          aria-hidden
                        >
                          {col.isPrimary ? 'key' : col.isForeign ? 'link' : 'circle'}
                        </span>
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="text-xs font-mono text-on-surface-variant break-all">{col.name}</span>
                            {idxBadge}
                            <span className="text-xs font-mono text-outline shrink-0 ml-auto">{col.type}</span>
                          </div>
                          {col.references ? (
                            <p className="text-[10px] font-mono text-secondary/90 leading-snug break-all pl-0.5">
                              <span className="text-outline/80">FK →</span> {col.references}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {partitionNames.length > 0 ||
                addedPartitionNames.length > 0 ||
                removedPartitionNames.length > 0 ? (
                  <div className="mt-2 rounded-md border border-outline-variant/10 bg-surface-container-low/70 px-3 py-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-outline">
                      Partitions
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {partitionNames.map((name) => (
                        <span
                          key={`base-part-${table.name}-${name}`}
                          className="inline-flex items-center rounded-[10px] border border-outline-variant/10 bg-surface-container-high px-1.5 py-0.5 text-[10px] font-mono text-on-surface-variant"
                        >
                          {name}
                        </span>
                      ))}
                      {addedPartitionNames.map((name) => (
                        <span
                          key={`added-part-${table.name}-${name}`}
                          className="inline-flex items-center rounded-[10px] border border-blue-400/45 bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-mono text-blue-200"
                        >
                          + {name}
                        </span>
                      ))}
                      {removedPartitionNames.map((name) => (
                        <span
                          key={`removed-part-${table.name}-${name}`}
                          className="inline-flex items-center rounded-[10px] border border-error/35 bg-error/20 px-1.5 py-0.5 text-[10px] font-mono text-error"
                        >
                          - {name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
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

function countSessionSchemaDiffChanges(diff: SessionSchemaDiffResponse): number {
  const sections = [
    diff.indexes,
    diff.views,
    diff.materializedViews,
    diff.functions,
    diff.partitions,
  ];
  return sections.reduce(
    (sum, s) => sum + s.added.length + s.removed.length + s.changed.length,
    0,
  );
}

function formatSessionSchemaDiffBrief(diff: SessionSchemaDiffResponse): string {
  const parts: string[] = [];
  const push = (label: string, section: SessionSchemaDiffSection<unknown>) => {
    const n = section.added.length + section.removed.length + section.changed.length;
    if (n > 0) {
      parts.push(`${label} ${n}`);
    }
  };
  push('idx', diff.indexes);
  push('views', diff.views);
  push('matv', diff.materializedViews);
  push('fn', diff.functions);
  push('part', diff.partitions);
  return parts.join(' · ');
}

function CompareSchemaVsBaseRows({ items, sessionId }: { items: CompareSlot[]; sessionId: string }) {
  const { data: liveDiff, isLoading, isError } = useSessionSchemaDiff(sessionId);

  const liveMainLine = useMemo(() => {
    if (isLoading) {
      return '…';
    }
    if (isError || !liveDiff) {
      return '—';
    }
    if (!liveDiff.hasChanges) {
      return 'No drift';
    }
    const n = countSessionSchemaDiffChanges(liveDiff);
    return `${n} change${n === 1 ? '' : 's'}`;
  }, [liveDiff, isError, isLoading]);

  const liveSubLine = useMemo(() => {
    if (!liveDiff?.hasChanges) {
      return null;
    }
    return formatSessionSchemaDiffBrief(liveDiff);
  }, [liveDiff]);

  const hasAnySnapshot = items.some((i) => i.execution.schemaDiffSnapshot);

  return (
    <>
      <TableRow>
        <TableCell className="align-top text-xs font-medium text-on-surface">Schema vs base</TableCell>
        {items.map((item) => {
          const snap = item.execution.schemaDiffSnapshot;
          const mainLine = snap
            ? snap.hasChanges
              ? `${snap.totalChanges} change${snap.totalChanges === 1 ? '' : 's'}`
              : 'No drift'
            : liveMainLine;
          const subLine = snap
            ? snap.hasChanges && snap.brief
              ? snap.brief
              : null
            : liveSubLine;

          return (
            <TableCell
              key={`schema-${item.label}`}
              className="align-top font-mono text-xs tabular-nums text-on-surface"
            >
              <div className="flex flex-col gap-0.5">
                <span>{mainLine}</span>
                {subLine ? (
                  <span className="whitespace-normal break-words font-sans text-[10px] font-normal leading-snug text-on-surface-variant">
                    {subLine}
                  </span>
                ) : null}
                {!snap ? (
                  <span className="font-sans text-[10px] italic text-outline">
                    Current session (no snapshot for this run)
                  </span>
                ) : null}
              </div>
            </TableCell>
          );
        })}
      </TableRow>
      <TableRow>
        <TableCell
          colSpan={items.length + 1}
          className="border-t border-outline-variant/10 bg-surface-container-low/40 py-2 text-[10px] leading-snug text-outline"
        >
          {hasAnySnapshot
            ? 'Each column shows catalog template drift at the moment that query finished (PostgreSQL). Older history rows may not have a snapshot.'
            : 'Per-run snapshots appear after you execute queries with an updated worker. Until then, columns show the current session vs base.'}
        </TableCell>
      </TableRow>
    </>
  );
}

function ComparePlanMetricsTable({ items, sessionId }: { items: CompareSlot[]; sessionId: string }) {
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
      values: items.map((item) => {
        const c = item.execution.executionPlan?.totalCost;
        return c != null && Number.isFinite(c) ? c : null;
      }),
      display: items.map((item) => {
        const c = item.execution.executionPlan?.totalCost;
        if (c == null || !Number.isFinite(c)) return '—';
        return formatPlannerEstimatedCost(c);
      }),
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
          <CompareSchemaVsBaseRows sessionId={sessionId} items={items} />
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
            <p className="text-[10px] uppercase tracking-[0.14em] text-outline">Your rank</p>
            <p className="mt-1 text-sm font-semibold text-on-surface">
              {viewerState === 'ranked'
                ? `#${ctx?.viewerRank}`
                : viewerState === 'signed-out'
                  ? 'Not signed in'
                  : 'No rank yet'}
            </p>
          </div>
          <div className="rounded-xl border border-outline-variant/15 bg-surface-container-high/50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.14em] text-outline">Passed</p>
            <p className="mt-1 text-sm font-semibold text-on-surface">{ctx?.totalRankedUsers ?? '—'}</p>
          </div>
        </div>
      </div>

      {leaderboardContextQuery.isLoading ? (
        <div className="mt-4 h-24 animate-pulse rounded-xl bg-surface-container-high/60" />
      ) : leaderboardContextQuery.isError ? (
        <p className="mt-4 text-xs text-error">Failed to load leaderboard.</p>
      ) : entries.length === 0 ? (
        <p className="mt-4 text-xs text-on-surface-variant">No passing attempts yet.</p>
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
                      {isViewer ? <span className="ml-1 text-primary">(you)</span> : null}
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
                          toast.success('Copied');
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
                toast.success('Copied');
              });
            }}
          >
            Copy my SQL
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function SideBySideComparePanel({
  sessionId,
  queryHistory,
  challengeVersionId,
}: {
  sessionId: string;
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

  const executionsSig = useMemo(() => executions.map((e) => e.id).join('\0'), [executions]);
  const [picksSig, setPicksSig] = useState(executionsSig);
  if (executionsSig !== picksSig) {
    setPicksSig(executionsSig);
    setPicks((prev) => {
      const available = executions.map((e) => e.id);
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
      let unchanged = next.length === prev.length;
      if (unchanged) {
        for (let i = 0; i < next.length; i += 1) {
          if (next[i] !== prev[i]) {
            unchanged = false;
            break;
          }
        }
      }
      return unchanged ? prev : next;
    });
  }

  const selectedItems: CompareSlot[] = [];
  for (let index = 0; index < compareLabels.length; index += 1) {
    if (index >= activeSlotCount) break;
    const label = compareLabels[index]!;
    const id = picks[index];
    const execution = executions.find((e) => e.id === id);
    if (execution) {
      selectedItems.push({ label, execution });
    }
  }

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
            <p className="text-sm font-medium text-on-surface">Compare</p>
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
                title="Add a compare query slot"
              >
                <span className="material-symbols-outlined text-[14px] leading-none">add</span>
              </button>
            </div>
          </div>

          {executions.length < 2 ? (
            <div className="mt-3 rounded-lg border border-dashed border-outline-variant/25 bg-surface-container-high/30 px-3 py-2.5 text-[11px] text-on-surface-variant">
              Add at least one run from History.
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
                        <option value="">None</option>
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
                      title={`Remove slot ${label}`}
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

        {selectedItems.length >= 2 ? (
          <ComparePlanMetricsTable items={selectedItems} sessionId={sessionId} />
        ) : null}
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

function RevertSchemaChangeModal({
  open,
  payload,
  isPending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  payload: RevertSessionSchemaChangePayload | null;
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

  if (!open || !payload) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={() => {
        if (!isPending) {
          onCancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="revert-schema-title"
        className="w-full max-w-md rounded-xl border border-outline-variant/15 bg-surface-container-low p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start gap-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-error/10 text-error">
            <span className="material-symbols-outlined text-[22px]">undo</span>
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
              Schema Diff
            </p>
            <h2 id="revert-schema-title" className="mt-1 text-lg font-semibold text-on-surface">
              Revert this change in the sandbox?
            </h2>
            <p className="mt-2 text-sm leading-6 text-on-surface-variant">
              This will run SQL on the sandbox database to revert this change.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-outline-variant/10 bg-surface-container-high/50 px-3 py-2.5 font-mono text-[11px] leading-5 text-on-surface-variant space-y-1">
          <p>
            <span className="text-outline">Type</span>{' '}
            <span className="text-on-surface">{payload.resourceType}</span>
          </p>
          <p>
            <span className="text-outline">Change</span>{' '}
            <span className="text-on-surface">{payload.changeType}</span>
          </p>
          <p>
            <span className="text-outline">Name</span>{' '}
            <span className="text-on-surface">{payload.name}</span>
          </p>
          {payload.tableName ? (
            <p>
              <span className="text-outline">Table</span>{' '}
              <span className="text-on-surface">{payload.tableName}</span>
            </p>
          ) : null}
          {payload.signature ? (
            <p>
              <span className="text-outline">Signature</span>{' '}
              <span className="text-on-surface break-all">{payload.signature}</span>
            </p>
          ) : null}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={isPending}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            loading={isPending}
            onClick={onConfirm}
            leftIcon={<span className="material-symbols-outlined text-[18px]">undo</span>}
          >
            Revert
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
  onRemove,
}: {
  tone: 'added' | 'removed' | 'changed';
  title: string;
  subtitle?: string | null;
  tableName?: string | null;
  fields?: string[] | null;
  definition?: string | null;
  previousDefinition?: string | null;
  onRemove?: () => void;
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
    <div className={cn('relative rounded-lg border px-2.5 py-2', toneClass)}>
      {onRemove ? (
        <button
          type="button"
          className="absolute -right-2 -top-2 inline-flex h-5 w-5 items-center justify-center rounded-full border border-error/45 bg-surface-container-low/90 text-error/85 shadow-sm hover:bg-error/15 hover:text-error"
          title="Revert this change in the sandbox"
          onClick={onRemove}
        >
          <span className="material-symbols-outlined text-[13px] leading-none">remove</span>
        </button>
      ) : null}
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
  const queryClient = useQueryClient();
  const [revertTarget, setRevertTarget] = useState<RevertSessionSchemaChangePayload | null>(null);
  const { data: diff, isLoading, isError, error } = useSessionSchemaDiff(sessionId);
  const revertChangeMutation = useMutation({
    mutationFn: (payload: RevertSessionSchemaChangePayload) =>
      sessionsApi.revertSchemaDiffChange(sessionId, payload),
    onSuccess: () => {
      toast.success('Schema change reverted in sandbox.');
      queryClient.invalidateQueries({ queryKey: ['session-schema-diff', sessionId] });
      queryClient.invalidateQueries({ queryKey: ['session-schema', sessionId] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to revert schema change');
    },
  });

  const openRevertConfirm = useCallback(
    (payload: RevertSessionSchemaChangePayload) => {
      if (revertChangeMutation.isPending) return;
      setRevertTarget(payload);
    },
    [revertChangeMutation.isPending],
  );

  const handleConfirmRevert = useCallback(() => {
    if (!revertTarget) return;
    revertChangeMutation.mutate(revertTarget, {
      onSettled: () => setRevertTarget(null),
    });
  }, [revertTarget, revertChangeMutation]);

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
    resourceType: RevertSessionSchemaChangePayload['resourceType'],
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
    identify: (item: T) => Pick<RevertSessionSchemaChangePayload, 'name' | 'tableName' | 'signature'>,
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
          {section.added.map((item, idx) => {
            const formatted = describe(item);
            const entryKey = `${title}:added:${idx}`;
            const identity = identify(item);
            return (
              <SchemaDiffEntry
                key={entryKey}
                tone="added"
                title={formatted.title}
                subtitle={formatted.subtitle}
                tableName={formatted.tableName}
                fields={formatted.fields}
                definition={formatted.definition}
                onRemove={() =>
                  openRevertConfirm({
                    resourceType,
                    changeType: 'added',
                    ...identity,
                  })
                }
              />
            );
          })}
          {section.removed.map((item, idx) => {
            const formatted = describe(item);
            const entryKey = `${title}:removed:${idx}`;
            const identity = identify(item);
            return (
              <SchemaDiffEntry
                key={entryKey}
                tone="removed"
                title={formatted.title}
                subtitle={formatted.subtitle}
                tableName={formatted.tableName}
                fields={formatted.fields}
                definition={formatted.definition}
                onRemove={() =>
                  openRevertConfirm({
                    resourceType,
                    changeType: 'removed',
                    ...identity,
                  })
                }
              />
            );
          })}
          {section.changed.map((item, idx) => {
            const currentFormatted = (describeChanged ?? describe)(item.current);
            const baseFormatted = describe(item.base);
            const entryKey = `${title}:changed:${idx}`;
            const identity = identify(item.current);
            return (
              <SchemaDiffEntry
                key={entryKey}
                tone="changed"
                title={currentFormatted.title}
                subtitle={currentFormatted.subtitle}
                tableName={currentFormatted.tableName}
                fields={currentFormatted.fields}
                definition={currentFormatted.definition}
                previousDefinition={baseFormatted.definition}
                onRemove={() =>
                  openRevertConfirm({
                    resourceType,
                    changeType: 'changed',
                    ...identity,
                  })
                }
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
    <>
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
                Reset to base
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
                'indexes',
                'database',
                diff.indexes,
                (item) => ({
                  title: item.name,
                  subtitle: null,
                  tableName: item.tableName,
                  fields: extractIndexFieldsFromDefinition(item.definition),
                  definition: null,
                }),
                (item) => ({
                  name: item.name,
                  tableName: item.tableName,
                }),
              )}
              {renderSection(
                'Views',
                'views',
                'preview',
                diff.views,
                (item) => ({
                  title: item.name,
                  definition: null,
                }),
                (item) => ({
                  name: item.name,
                }),
              )}
              {renderSection(
                'Materialized Views',
                'materializedViews',
                'inventory_2',
                diff.materializedViews,
                (item) => ({
                  title: item.name,
                  definition: null,
                }),
                (item) => ({
                  name: item.name,
                }),
              )}
              {renderSection(
                'Functions',
                'functions',
                'code_blocks',
                diff.functions,
                (item) => ({
                  title: `${item.name}(${item.signature})`,
                  subtitle: item.language ? `Language ${item.language}` : null,
                  definition: null,
                }),
                (item) => ({
                  name: item.name,
                  signature: item.signature,
                }),
              )}
              {renderSection(
                'Partitions',
                'partitions',
                'splitscreen',
                diff.partitions,
                (item) => ({
                  title: item.name,
                  subtitle: `${item.parentTable}${item.strategy ? ` · ${item.strategy}` : ''}`,
                  definition: null,
                }),
                (item) => ({
                  name: item.name,
                }),
              )}
            </div>
          )}
        </div>
      </div>
      <RevertSchemaChangeModal
        open={revertTarget !== null}
        payload={revertTarget}
        isPending={revertChangeMutation.isPending}
        onCancel={() => setRevertTarget(null)}
        onConfirm={handleConfirmRevert}
      />
    </>
  );
}

// ─── Session Expired / Ended Overlay ─────────────────────────────────────────

function LabSessionExpired({ status }: { status: string }) {
  const label =
    status === 'expired' ? 'Lab session has expired' :
    status === 'failed'  ? 'Lab session failed' :
                           'Lab session has ended';
  const desc =
    status === 'failed'
      ? 'Sandbox could not start. Try creating a new session.'
      : 'This session is no longer active. Start a new session to continue.';

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
              Choose another database
            </Button>
          </Link>
          <Link href="/lab">
            <Button variant="secondary">Back to SQL Lab</Button>
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
        <h1 className="font-headline text-xl font-semibold text-on-surface">Could not load lab session</h1>
        <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">{message}</p>
        <p className="mt-3 text-xs text-outline">
          Check that the API is running, you are signed in, and the session still exists on the server.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="primary" onClick={onRetry} leftIcon={<span className="material-symbols-outlined text-lg">refresh</span>}>
          Try again
        </Button>
        <Link href="/lab">
          <Button variant="secondary">Back to SQL Lab</Button>
        </Link>
        <Link href="/explore">
          <Button variant="ghost">Catalog</Button>
        </Link>
      </div>
    </div>
  );
}

export default function LabPage({ params }: ClientPageProps) {
  const router = useRouter();
  const sessionId = params.sessionId ?? '';
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
    currentQuery,
    hydrateEditorTabs,
    setQuery,
    selectedScale,
    sourceScale,
    sourceRowCount,
    setSelectedScale,
  } = useLabStore();

  const { mutate: executeQuery, cancelExecution } = useExecuteQuery();
  const { mutate: explainQuery, cancelExplain } = useExplainQuery();
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
  const submittedQueryExecutionIds = useMemo(
    () => new Set(challengeAttempts.map((a) => a.queryExecutionId)),
    [challengeAttempts],
  );
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
  /** Avoid repeating the DB/catalog label next to "Sandbox" when it already appears in the DB / Dialect / Scale chip. */
  const headerContextTitle = (() => {
    const t = lessonTitle?.trim();
    if (!t) return null;
    if (t === displayDatabaseName.trim()) return null;
    const wireDb = session?.sandbox?.dbName?.trim();
    if (wireDb && t === wireDb) return null;
    return lessonTitle;
  })();
  const latestSuccessfulExecution =
    queryHistory.find((execution) => execution.status === 'success') ?? null;
  const isLatestExecutionAlreadySubmitted = Boolean(
    latestSuccessfulExecution && submittedQueryExecutionIds.has(latestSuccessfulExecution.id),
  );
  const latestChallengeAttempt = challengeAttempts[0] ?? null;
  const latestAttemptEvaluation = latestChallengeAttempt?.evaluation ?? null;
  const latestAttemptPassChecks = latestAttemptEvaluation?.passCriterionChecks ?? [];
  const hasChallengeAttemptFeedbackPanel =
    session?.challengeVersionId != null &&
    latestChallengeAttempt != null &&
    latestAttemptEvaluation != null &&
    (Boolean(latestAttemptEvaluation.feedbackText?.trim()) || latestAttemptPassChecks.length > 0);
  const explainPlanMode = getExplainPlanMode(currentQuery);
  const effectiveSessionStatus = getEffectiveSessionStatus(session);
  const isProvisioningWithEstimate =
    session?.status === 'provisioning' && Boolean(session.provisioningEstimate);
  const provisioningRemainingSec = useProvisioningRemainingSeconds(
    isProvisioningWithEstimate,
    session?.provisioningEstimate,
  );
  const provisioningEstimateTotalSec = session?.provisioningEstimate?.estimatedSeconds ?? 0;
  const provisioningProgressRatio =
    isProvisioningWithEstimate &&
    provisioningRemainingSec != null &&
    Number.isFinite(provisioningEstimateTotalSec) &&
    provisioningEstimateTotalSec > 0
      ? Math.min(1, Math.max(0, 1 - provisioningRemainingSec / provisioningEstimateTotalSec))
      : 0;
  const provisioningCountdownLabel =
    isProvisioningWithEstimate && provisioningRemainingSec != null
      ? formatProvisioningRemaining(provisioningRemainingSec)
      : '';
  const provisioningPastEstimate =
    session?.status === 'provisioning' &&
    provisioningRemainingSec != null &&
    provisioningRemainingSec <= 0;
  const provisioningSandboxTitle =
    effectiveSessionStatus === 'provisioning'
      ? provisioningPastEstimate
        ? 'Sandbox: Still provisioning — time estimate passed. The database engine is often already running; the worker may still be restoring or loading the dataset (large imports can take several minutes).'
        : provisioningCountdownLabel
          ? `Sandbox: Provisioning (${provisioningCountdownLabel} left)`
          : 'Sandbox: Provisioning'
      : effectiveSessionStatus === 'active'
        ? 'Sandbox: Ready'
        : `Sandbox: ${effectiveSessionStatus ?? 'Unknown'}`;
  const provisioningSandboxAria =
    effectiveSessionStatus === 'provisioning'
      ? provisioningPastEstimate
        ? 'Sandbox still provisioning. Estimated time has passed; dataset restore or load may still be in progress.'
        : provisioningCountdownLabel
          ? `Sandbox provisioning, ${provisioningCountdownLabel}`
          : 'Sandbox provisioning'
      : effectiveSessionStatus === 'active'
        ? 'Sandbox ready'
        : `Sandbox ${effectiveSessionStatus ?? 'unknown'}`;
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
      if (process.env.NODE_ENV === 'development') {
        const ev = attempt.evaluation;
        console.groupCollapsed('[SQLForge] Challenge submit (see API terminal/Docker for EXPLAIN logs)');
        console.log('queryExecutionId', attempt.queryExecutionId);
        console.log('evaluation snapshot', {
          queryTotalCost: ev?.queryTotalCost ?? null,
          queryActualTime: ev?.queryActualTime ?? null,
          meetsCostTarget: ev?.meetsCostTarget ?? null,
          maxTotalCost: ev?.maxTotalCost ?? null,
          passCriterionChecks: ev?.passCriterionChecks ?? [],
          feedbackPreview: ev?.feedbackText?.slice(0, 200) ?? null,
        });
        console.info(
          'EXPLAIN / planner-cost traces are logged on the API process (e.g. `docker compose logs -f api`), not in the browser. Set PLANNER_COST_DEBUG=1 in API .env for extra detail.',
        );
        console.groupEnd();
      }
      queryClient.invalidateQueries({
        queryKey: ['challenge-attempts', session?.challengeVersionId],
      });
      if (session?.challengeVersionId) {
        queryClient.invalidateQueries({
          queryKey: ['challenge-leaderboard-context', session.challengeVersionId],
        });
      }
      if (attempt.status === 'passed') {
        toast.success(`Challenge passed. +${attempt.score ?? 0} pts.`, { duration: 4000 });
      } else {
        toast.error('Challenge requirements not met. See details below the toolbar.', { duration: 5000 });
      }
      setActiveTab('history');
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Failed to submit challenge attempt';
      if (/already been submitted/i.test(msg)) {
        toast(msg, { duration: 4500, icon: 'ℹ️' });
        return;
      }
      toast.error(msg);
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
      void useAuthStore.getState().refreshProfile();
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
  const [appliedNoticeKey, setAppliedNoticeKey] = useState('');
  const editorNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [challengeFeedbackExpanded, setChallengeFeedbackExpanded] = useState(false);
  const lastChallengeAttemptIdRef = useRef<string | null>(null);
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
    const attempt = latestChallengeAttempt;
    if (!attempt?.id) {
      lastChallengeAttemptIdRef.current = null;
      return;
    }
    const ev = attempt.evaluation;
    if (!ev) {
      return;
    }
    const checks = ev.passCriterionChecks ?? [];
    const hasPanel = Boolean(ev.feedbackText?.trim()) || checks.length > 0;
    if (!hasPanel) {
      return;
    }
    if (attempt.id === lastChallengeAttemptIdRef.current) return;
    lastChallengeAttemptIdRef.current = attempt.id;
    queueMicrotask(() => setChallengeFeedbackExpanded(attempt.status !== 'passed'));
  }, [latestChallengeAttempt]);

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
    } catch {
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
    if (editorNotice === 'error') {
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

  const lastExecNoticeKey = lastExecution
    ? `${lastExecution.id}:${lastExecution.status}`
    : '';
  if (lastExecNoticeKey && lastExecNoticeKey !== appliedNoticeKey) {
    setAppliedNoticeKey(lastExecNoticeKey);
    setEditorNotice(lastExecution!.status === 'success' ? 'success' : 'error');
  }

  if (!sessionId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-surface px-4">
        <p className="text-sm text-on-surface-variant">Invalid session path.</p>
        <Link href="/lab">
          <Button variant="primary">Back to SQL Lab</Button>
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
        message={sessionFetchError instanceof Error ? sessionFetchError.message : 'Unknown error'}
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
              {isExecuting ? (
                <Button
                  variant="destructive"
                  size="sm"
                  className="border border-error/25"
                  onClick={() => cancelExecution()}
                  title="Stop the running query"
                  leftIcon={
                    <span
                      className="material-symbols-outlined shrink-0 text-[18px] leading-none"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                      aria-hidden
                    >
                      stop
                    </span>
                  }
                >
                  Cancel
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  disabled={
                    !currentQuery.trim() ||
                    scaleSwitchMutation.isPending ||
                    resetSandboxMutation.isPending ||
                    !isSessionReady
                  }
                  onClick={() => executeQuery({ sessionId, sql: currentQuery })}
                  leftIcon={
                    <span className="material-symbols-outlined shrink-0 text-[18px] leading-none" style={{ fontVariationSettings: "'FILL' 1" }}>
                      play_arrow
                    </span>
                  }
                >
                  Run
                </Button>
              )}
              {isExplaining ? (
                <Button
                  variant="destructive"
                  size="sm"
                  className="border border-error/25"
                  onClick={() => cancelExplain()}
                  title="Stop generating the execution plan"
                  leftIcon={
                    <span
                      className="material-symbols-outlined shrink-0 text-[18px] leading-none"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                      aria-hidden
                    >
                      stop
                    </span>
                  }
                >
                  Cancel
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={
                    !currentQuery.trim() ||
                    !explainPlanMode ||
                    isExecuting ||
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
                  leftIcon={
                    <span className="material-symbols-outlined shrink-0 text-[18px] leading-none">account_tree</span>
                  }
                >
                  Explain
                </Button>
              )}
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
                    submitAttemptMutation.isPending ||
                    isLatestExecutionAlreadySubmitted
                  }
                  onClick={() => submitAttemptMutation.mutate()}
                  leftIcon={<span className="material-symbols-outlined text-[18px]">flag</span>}
                  title={
                    !latestSuccessfulExecution
                      ? 'Run a successful query first'
                      : isLatestExecutionAlreadySubmitted
                        ? 'This run was already submitted. Run the query again to submit a new attempt.'
                        : 'Submit the latest successful query execution for challenge scoring'
                  }
                >
                  Submit
                </Button>
              ) : null}
            </div>
            <DatasetScaleSelector
              selectedScale={selectedScale}
              sourceScale={sourceScale}
              sourceRowCount={sourceRowCount}
              databaseName={displayDatabaseName}
              dialect={session?.dialect ?? null}
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
            {headerContextTitle && (
              <span className="hidden max-w-[14rem] truncate text-xs text-on-surface-variant md:block">
                {headerContextTitle}
              </span>
            )}
            <div
              className="flex min-w-0 items-center gap-2 rounded-full border border-outline-variant/15 bg-surface-container-high/60 px-2 py-1 sm:gap-2.5 sm:px-3 sm:py-1.5"
              title={provisioningSandboxTitle}
              aria-label={provisioningSandboxAria}
            >
              <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-outline sm:inline">
                Sandbox
              </span>
              <span
                className="hidden h-3 w-px shrink-0 bg-outline/25 sm:block"
                aria-hidden
              />
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    effectiveSessionStatus === 'active'
                      ? 'bg-green-400 shadow-[0_0_8px_rgba(34,197,94,0.45)]'
                      : effectiveSessionStatus === 'provisioning'
                        ? 'animate-pulse bg-tertiary'
                        : 'bg-outline',
                  )}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex min-w-0 items-baseline gap-2 text-[11px] leading-none">
                    {effectiveSessionStatus === 'provisioning' ? (
                      <>
                        <span className="shrink-0 font-medium text-on-surface">Provisioning</span>
                        {provisioningCountdownLabel ? (
                          <span
                            className="min-w-[2.75rem] font-medium tabular-nums tracking-tight text-on-surface-variant"
                            aria-live="polite"
                            aria-atomic="true"
                          >
                            {provisioningCountdownLabel}
                          </span>
                        ) : null}
                      </>
                    ) : effectiveSessionStatus === 'active' ? (
                      <span className="font-medium text-on-surface-variant">Ready</span>
                    ) : (
                      <span className="font-medium text-on-surface-variant">
                        {effectiveSessionStatus ?? '—'}
                      </span>
                    )}
                  </div>
                  {effectiveSessionStatus === 'provisioning' && provisioningCountdownLabel ? (
                    <div
                      className="h-0.5 w-full max-w-[7rem] overflow-hidden rounded-full bg-outline/20"
                      aria-hidden
                    >
                      <div
                        className="h-full rounded-full bg-tertiary/80 transition-[width] duration-1000 ease-linear"
                        style={{ width: `${Math.round(provisioningProgressRatio * 100)}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
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

      {hasChallengeAttemptFeedbackPanel && latestChallengeAttempt && latestAttemptEvaluation ? (
        <div
          role="region"
          aria-label="Challenge attempt feedback"
          className={cn(
            'shrink-0 border-b text-sm',
            latestChallengeAttempt.status === 'passed'
              ? 'border-outline-variant/50 bg-surface-container-low'
              : 'border-error/25 bg-error/5',
          )}
        >
          <div className="w-full px-4 py-1.5">
            {latestAttemptPassChecks.length > 0 ? (
              <div className="flex w-full min-w-0 flex-col gap-2">
                {latestChallengeAttempt.status !== 'passed' &&
                latestAttemptEvaluation.passesChallenge === false &&
                latestAttemptEvaluation.isCorrect === false ? (
                  <div
                    role="alert"
                    className="rounded-lg border border-error/30 bg-error/10 px-2.5 py-2 text-xs leading-snug text-on-surface"
                  >
                    <p className="font-semibold text-error">Challenge not passed yet.</p>
                    {extractPrimaryChallengeFeedback(latestAttemptEvaluation.feedbackText) ? (
                      <p className="mt-2 whitespace-pre-wrap break-words text-on-surface">
                        {extractPrimaryChallengeFeedback(latestAttemptEvaluation.feedbackText)}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <div role="status" className="flex w-full min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="inline-flex shrink-0 items-center self-center text-xs font-medium leading-none text-on-surface-variant">
                    Expected:
                  </span>
                  <div className="flex min-h-[28px] min-w-0 flex-1 basis-0 items-center">
                    <ChallengeAttemptCriteriaChecks
                      checks={latestAttemptPassChecks}
                      evaluation={latestAttemptEvaluation}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  id="challenge-feedback-toggle"
                  aria-expanded={challengeFeedbackExpanded}
                  aria-controls="challenge-feedback-body"
                  onClick={() => setChallengeFeedbackExpanded((v) => !v)}
                  className="flex w-full items-center gap-2 rounded-lg py-1 text-left transition-colors hover:bg-surface-container-high/40"
                >
                  <span className="material-symbols-outlined shrink-0 text-lg text-on-surface-variant">
                    {challengeFeedbackExpanded ? 'expand_less' : 'expand_more'}
                  </span>
                  <div className="min-w-0 flex-1">
                    {!challengeFeedbackExpanded ? (
                      <p className="truncate text-xs text-on-surface-variant">Tap to expand full details</p>
                    ) : null}
                  </div>
                  <span className="shrink-0 rounded-full border border-outline-variant/20 px-2 py-0.5 text-[10px] font-medium text-on-surface-variant">
                    {challengeFeedbackExpanded ? 'Collapse' : 'Expand'}
                  </span>
                </button>
                {challengeFeedbackExpanded && latestAttemptEvaluation.feedbackText?.trim() ? (
                  <div
                    id="challenge-feedback-body"
                    role="status"
                    className="mt-1.5 border-t border-outline-variant/10 pt-1.5"
                  >
                    <p className="whitespace-pre-wrap break-words text-xs leading-snug text-on-surface">
                      {latestAttemptEvaluation.feedbackText}
                    </p>
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      ) : null}

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
            onDismissErrorNotice={() => setEditorNotice(null)}
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
                    .then(() => toast.success('Copied results (CSV)'));
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
                sessionId={sessionId}
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
