'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLabStore } from '@/stores/lab';
import toast from 'react-hot-toast';
import { useExecuteQuery, useExplainQuery, useSessionStatus } from '@/hooks/use-query-execution';
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
import { cn, formatDuration, formatRows, formatRelativeTime, truncateSql } from '@/lib/utils';
import type { QueryResultColumn } from '@/lib/api';
import { SqlEditor } from '@/components/ui/sql-editor';

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

// ─── Dataset Size Selector ────────────────────────────────────────────────────

const DATASET_SIZES = [
  { value: 'tiny', label: 'Tiny', desc: '~1K rows' },
  { value: 'small', label: 'Small', desc: '~10K rows' },
  { value: 'medium', label: 'Medium', desc: '~100K rows' },
  { value: 'large', label: 'Large', desc: '~1M rows' },
] as const;

function DatasetSizeSelector() {
  const { datasetSize, setDatasetSize } = useLabStore();
  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border border-outline-variant/10 bg-surface-container-low p-0.5"
      title="Dataset scale for query execution"
    >
      {DATASET_SIZES.map((s) => (
        <button
          key={s.value}
          type="button"
          onClick={() => setDatasetSize(s.value)}
          className={cn(
            'rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
            datasetSize === s.value
              ? 'bg-surface-container-high text-on-surface shadow-sm'
              : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
          )}
          title={s.desc}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

// ─── SQL Editor (CodeMirror 6) ────────────────────────────────────────────────

function SqlEditorPanel() {
  const { currentQuery, setQuery } = useLabStore();
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
      placeholder="-- Write your SQL query here...&#10;-- Press Ctrl+Enter to execute"
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
  );
}

// ─── Execution Plan Panel ─────────────────────────────────────────────────────

function ExecutionPlanPanel() {
  const { executionPlan, isExplaining } = useLabStore();

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
            Click Explain to see the execution plan
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-4">
      <pre className="text-xs font-mono text-on-surface-variant bg-surface-container-lowest rounded-xl p-4 overflow-auto">
        {JSON.stringify(executionPlan.plan, null, 2)}
      </pre>
      {executionPlan.totalCost !== undefined && (
        <div className="mt-3 flex gap-4 text-xs text-on-surface-variant">
          <span>Total Cost: <span className="text-primary font-mono">{executionPlan.totalCost}</span></span>
          {executionPlan.actualTime !== undefined && (
            <span>Actual Time: <span className="text-tertiary font-mono">{executionPlan.actualTime}ms</span></span>
          )}
        </div>
      )}
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

const MOCK_SCHEMA = [
  {
    name: 'employees',
    columns: [
      { name: 'id', type: 'INTEGER', primary: true },
      { name: 'name', type: 'VARCHAR(100)', primary: false },
      { name: 'department_id', type: 'INTEGER', primary: false },
      { name: 'salary', type: 'DECIMAL(10,2)', primary: false },
      { name: 'hired_at', type: 'TIMESTAMP', primary: false },
    ],
  },
  {
    name: 'departments',
    columns: [
      { name: 'id', type: 'INTEGER', primary: true },
      { name: 'name', type: 'VARCHAR(50)', primary: false },
      { name: 'budget', type: 'DECIMAL(15,2)', primary: false },
    ],
  },
  {
    name: 'orders',
    columns: [
      { name: 'id', type: 'INTEGER', primary: true },
      { name: 'customer_id', type: 'INTEGER', primary: false },
      { name: 'total', type: 'DECIMAL(10,2)', primary: false },
      { name: 'status', type: 'VARCHAR(20)', primary: false },
      { name: 'created_at', type: 'TIMESTAMP', primary: false },
    ],
  },
];

function SchemaPanel() {
  const [expandedTable, setExpandedTable] = useState<string | null>('employees');

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wider text-outline px-2 mb-3">
        Tables
      </p>
      {MOCK_SCHEMA.map((table) => {
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
                        col.primary ? 'text-primary' : 'text-outline'
                      )}
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      {col.primary ? 'key' : 'circle'}
                    </span>
                    <span className="text-xs font-mono text-on-surface-variant flex-1">
                      {col.name}
                    </span>
                    <span className="text-xs font-mono text-outline">{col.type}</span>
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

// ─── Main Lab Page ────────────────────────────────────────────────────────────

const TABS = [
  { id: 'results', label: 'Results', icon: 'table_rows' },
  { id: 'plan', label: 'Execution Plan', icon: 'account_tree' },
  { id: 'history', label: 'History', icon: 'history' },
  { id: 'schema', label: 'Schema', icon: 'schema' },
] as const;

type TabId = typeof TABS[number]['id'];

function LabSessionLoading() {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col bg-surface">
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
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-5 bg-surface px-4">
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
    results,
    error,
    currentQuery,
    setQuery,
  } = useLabStore();

  const { mutate: executeQuery } = useExecuteQuery();
  const { mutate: explainQuery } = useExplainQuery();

  const {
    data: session,
    isLoading: sessionLoading,
    isError: sessionError,
    error: sessionFetchError,
    refetch: refetchSession,
  } = useSessionStatus(sessionId);

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

  if (!sessionId) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-4 bg-surface px-4">
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
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col overflow-hidden bg-surface">
      <header className="shrink-0 border-b border-outline-variant/10 bg-surface-container-low/90">
        <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="scrollbar-none flex min-w-0 flex-wrap items-center gap-2 overflow-x-auto">
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-outline-variant/10 bg-surface-container/70 p-1">
              <Button
                variant="primary"
                size="sm"
                loading={isExecuting}
                disabled={!currentQuery.trim() || isExecuting || session?.status === 'provisioning'}
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
                disabled={!currentQuery.trim() || isExplaining || session?.status === 'provisioning'}
                onClick={() => explainQuery({ sessionId, sql: currentQuery })}
                leftIcon={<span className="material-symbols-outlined text-[18px]">account_tree</span>}
              >
                Explain
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!currentQuery.trim()}
                onClick={handleFormatSql}
                title="Format SQL locally (no network)"
                leftIcon={<span className="material-symbols-outlined text-[18px]">format_align_left</span>}
              >
                Format
              </Button>
            </div>
            <DatasetSizeSelector />
          </div>

          <div className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
            {session?.lessonTitle && (
              <span className="hidden max-w-[14rem] truncate text-xs text-on-surface-variant md:block">
                {session.lessonTitle}
              </span>
            )}
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

      {/* ── Main split pane ── */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {/* Left: Editor */}
        <div
          className="flex flex-col overflow-hidden"
          style={{ width: `${leftWidth}%` }}
        >
          <div className="flex items-center border-b border-outline-variant/10 bg-surface-container-low/80">
            <div className="flex items-center gap-2 border-r border-outline-variant/10 bg-surface-container px-4 py-2">
              <span className="material-symbols-outlined text-base text-tertiary" style={{ fontVariationSettings: "'FILL' 1" }}>
                terminal
              </span>
              <span className="font-mono text-xs text-on-surface">query.sql</span>
            </div>
            <div className="ml-auto flex items-center gap-2 px-3">
              <span className="font-mono text-[10px] uppercase text-outline">
                {currentQuery.split('\n').length} lines
              </span>
              <kbd className="hidden rounded border border-outline-variant/20 bg-surface-container px-1.5 py-0.5 font-mono text-[10px] text-on-surface-variant sm:inline">
                Ctrl+Enter
              </kbd>
            </div>
          </div>
          <SqlEditorPanel />
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
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {activeTab === 'results' && <ResultsPanel />}
            {activeTab === 'plan' && <ExecutionPlanPanel />}
            {activeTab === 'history' && <QueryHistoryPanel />}
            {activeTab === 'schema' && <SchemaPanel />}
          </div>
        </div>
      </div>

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
