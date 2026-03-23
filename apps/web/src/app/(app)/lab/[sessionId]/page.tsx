'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLabStore } from '@/stores/lab';
import { useExecuteQuery, useExplainQuery, useFormatSql, useSessionStatus } from '@/hooks/use-query-execution';
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
    <div className="flex items-center gap-1 bg-surface-container rounded-lg p-0.5">
      {DATASET_SIZES.map((s) => (
        <button
          key={s.value}
          onClick={() => setDatasetSize(s.value)}
          className={cn(
            'px-2 py-1 rounded text-xs font-medium font-body transition-all',
            datasetSize === s.value
              ? 'bg-surface-container-high text-on-surface'
              : 'text-on-surface-variant hover:text-on-surface'
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
  const { sessionId } = useParams<{ sessionId: string }>();
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
                  'material-symbols-outlined text-base transition-transform',
                  isExpanded ? 'rotate-90' : ''
                )}
                style={{ color: '#bac3ff' }}
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

export default function LabPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const {
    activeTab,
    setActiveTab,
    isExecuting,
    isExplaining,
    lastExecution,
    results,
    error,
    currentQuery,
  } = useLabStore();

  const { mutate: executeQuery } = useExecuteQuery();
  const { mutate: explainQuery } = useExplainQuery();
  const { mutate: formatSql, isPending: isFormatting } = useFormatSql();

  // Poll session status
  const { data: session } = useSessionStatus(sessionId);

  // Global keyboard shortcut: Ctrl+Enter to execute
  useEffect(() => {
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

  return (
    <div className="flex flex-col h-[calc(100vh-3.5rem)] bg-surface overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="flex items-center gap-2 px-4 py-2 bg-surface-container-low shrink-0">
        {/* Left: session info */}
        <div className="flex items-center gap-2 mr-2">
          {session ? (
            <>
              <StatusBadge status={session.status} />
              <span className="text-xs text-on-surface-variant hidden sm:block">
                {session.lesson?.title ?? session.track?.title ?? 'Free Session'}
              </span>
            </>
          ) : (
            <div className="h-5 w-24 bg-surface-container-high rounded animate-pulse" />
          )}
        </div>

        <div className="w-1" />

        {/* Execute */}
        <Button
          variant="primary"
          size="sm"
          loading={isExecuting}
          disabled={!currentQuery.trim() || session?.status === 'provisioning'}
          onClick={() => executeQuery({ sessionId, sql: currentQuery })}
          leftIcon={<span className="material-symbols-outlined text-sm">play_arrow</span>}
        >
          Execute
        </Button>

        {/* Explain */}
        <Button
          variant="secondary"
          size="sm"
          loading={isExplaining}
          disabled={!currentQuery.trim() || session?.status === 'provisioning'}
          onClick={() => explainQuery({ sessionId, sql: currentQuery })}
          leftIcon={<span className="material-symbols-outlined text-sm">account_tree</span>}
        >
          Explain
        </Button>

        {/* Format */}
        <Button
          variant="ghost"
          size="sm"
          loading={isFormatting}
          onClick={() => formatSql(currentQuery)}
          leftIcon={<span className="material-symbols-outlined text-sm">format_align_left</span>}
        >
          Format
        </Button>

        <div className="w-1" />

        {/* Dataset size */}
        <DatasetSizeSelector />

        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm">
            <span className="material-symbols-outlined text-sm">restart_alt</span>
          </Button>
        </div>
      </div>

      {/* ── Main split pane ── */}
      <div ref={containerRef} className="flex flex-1 overflow-hidden">
        {/* Left: Editor */}
        <div
          className="flex flex-col overflow-hidden"
          style={{ width: `${leftWidth}%` }}
        >
          <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container-lowest">
            <span className="material-symbols-outlined text-sm text-on-surface-variant">terminal</span>
            <span className="text-xs text-on-surface-variant font-mono">query.sql</span>
            <div className="ml-auto flex items-center gap-1">
              <span className="text-xs text-outline">
                {currentQuery.split('\n').length} lines
              </span>
              <kbd className="text-xs bg-surface-container px-1.5 py-0.5 rounded text-outline font-mono hidden sm:inline">
                Ctrl+Enter
              </kbd>
            </div>
          </div>
          <SqlEditorPanel />
        </div>

        {/* Resize handle */}
        <div
          className="resize-handle flex-none bg-transparent hover:bg-primary/50 transition-colors cursor-col-resize"
          style={{ width: '4px' }}
          onMouseDown={handleResizeMouseDown}
        />

        {/* Right: Results */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Tabs */}
          <div className="flex items-center gap-0 bg-surface-container-low shrink-0 overflow-x-auto">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as TabId)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium font-body whitespace-nowrap transition-all border-b-2',
                  activeTab === tab.id
                    ? 'text-primary border-primary bg-primary/5'
                    : 'text-on-surface-variant border-transparent hover:text-on-surface hover:bg-surface-container'
                )}
              >
                <span className="material-symbols-outlined text-sm">{tab.icon}</span>
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
      <div className="flex items-center gap-4 px-4 py-1.5 bg-surface-container shrink-0 text-xs text-on-surface-variant">
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              'w-1.5 h-1.5 rounded-full',
              session?.status === 'ready' || session?.status === 'active'
                ? 'bg-secondary'
                : session?.status === 'provisioning'
                ? 'bg-tertiary animate-pulse'
                : 'bg-outline'
            )}
          />
          <span className="capitalize">{session?.status ?? 'Connecting...'}</span>
        </div>

        <div className="h-3 w-px bg-outline-variant/30" />

        {lastExecution?.durationMs !== undefined && (
          <span>
            Duration:{' '}
            <span className="text-on-surface font-mono">
              {formatDuration(lastExecution.durationMs)}
            </span>
          </span>
        )}

        {results && (
          <>
            <span>
              Rows:{' '}
              <span className="text-on-surface font-mono">
                {formatRows(results.totalRows)}
                {results.truncated && ' (truncated)'}
              </span>
            </span>
            <span>
              Columns:{' '}
              <span className="text-on-surface font-mono">{results.columns.length}</span>
            </span>
          </>
        )}

        {error && (
          <span className="text-error">{error.slice(0, 60)}{error.length > 60 ? '...' : ''}</span>
        )}

        <div className="ml-auto text-outline">
          Session: <span className="font-mono">{sessionId.slice(0, 8)}...</span>
        </div>
      </div>
    </div>
  );
}
