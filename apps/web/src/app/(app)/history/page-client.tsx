'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatDuration, formatRelativeTime, formatRows, classifyQueryType } from '@/lib/utils';
import type { QueryExecution } from '@/lib/api';
import type { ClientPageProps } from '@/lib/page-props';

const STATUS_STRIP: Record<string, string> = {
  success: 'bg-secondary',
  error: 'bg-error',
  running: 'bg-tertiary',
  pending: 'bg-outline',
};

const STATUS_BADGE: Record<string, string> = {
  success: 'bg-secondary/10 text-secondary',
  error: 'bg-error-container/20 text-error',
  running: 'bg-tertiary/10 text-tertiary',
  pending: 'bg-outline/10 text-outline',
};

const STATUS_LABEL: Record<string, string> = {
  success: 'Success',
  error: 'Failed',
  running: 'Running',
  pending: 'Pending',
};

const QUERY_TYPE_COLORS: Record<string, string> = {
  SELECT: 'text-primary',
  INSERT: 'text-secondary',
  UPDATE: 'text-tertiary',
  DELETE: 'text-error',
  CREATE: 'text-on-surface-variant',
  DROP: 'text-error',
  ALTER: 'text-on-surface-variant',
  EXPLAIN: 'text-outline',
};

function QueryCard({ query }: { query: QueryExecution }) {
  const [expanded, setExpanded] = useState(false);
  const qType = classifyQueryType(query.sql);

  return (
    <div className="group relative bg-surface-container-low rounded-xl overflow-hidden hover:bg-surface-container transition-colors duration-200">
      <div className="flex">
        {/* Left status strip */}
        <div className={cn('w-1.5 shrink-0', STATUS_STRIP[query.status] ?? 'bg-outline')} />

        <div className="flex-1 p-5">
          {/* Header row */}
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span
                className={cn(
                  'px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase',
                  STATUS_BADGE[query.status] ?? 'bg-outline/10 text-outline'
                )}
              >
                {STATUS_LABEL[query.status] ?? query.status}
              </span>
              <span
                className={cn(
                  'text-[10px] font-mono font-bold uppercase tracking-wider',
                  QUERY_TYPE_COLORS[qType] ?? 'text-outline'
                )}
              >
                {qType}
              </span>
              <span className="text-xs text-outline font-mono">
                {formatRelativeTime(query.createdAt)}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0 ml-2">
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-1.5 rounded-lg hover:bg-surface-container-highest text-outline hover:text-on-surface transition-colors"
                title={expanded ? 'Collapse' : 'Expand'}
              >
                <span
                  className={cn(
                    'material-symbols-outlined text-lg transition-transform duration-200',
                    expanded && 'rotate-180'
                  )}
                >
                  expand_more
                </span>
              </button>
              <button className="flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary rounded-lg text-xs font-semibold hover:bg-primary/20 transition-all">
                <span className="material-symbols-outlined text-sm">open_in_new</span>
                Re-open
              </button>
            </div>
          </div>

          {/* SQL snippet */}
          <div className="bg-surface-container-lowest rounded-lg p-4 font-mono text-sm text-on-surface-variant mb-4">
            <pre className="whitespace-pre-wrap break-all leading-relaxed">
              {expanded ? query.sql : query.sql.split('\n').slice(0, 3).join('\n')}
            </pre>
          </div>

          {/* Error message */}
          {query.errorMessage && (
            <div className="mb-4 text-xs bg-error/10 text-error p-2.5 rounded-lg flex items-center gap-2">
              <span className="material-symbols-outlined text-sm shrink-0">error</span>
              <span className="font-mono">{query.errorMessage}</span>
            </div>
          )}

          {/* Metadata row */}
          <div className="flex items-center gap-5 text-xs font-medium text-outline">
            {query.durationMs !== undefined && (
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm">timer</span>
                <span>{formatDuration(query.durationMs)}</span>
              </div>
            )}
            {query.rowCount !== undefined && (
              <div className="flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm">reorder</span>
                <span>{formatRows(query.rowCount)} rows</span>
              </div>
            )}
          </div>

          {/* Expanded: result preview */}
          {expanded && query.result && query.result.rows.length > 0 && (
            <div className="mt-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-outline mb-2">
                Result Preview — {query.result.rows.length} rows
              </p>
              <div className="overflow-x-auto rounded-lg bg-surface-container-high">
                <table className="text-xs font-mono min-w-full">
                  <thead>
                    <tr>
                      {query.result.columns.map((col) => (
                        <th
                          key={col.name}
                          className="px-3 py-2 text-left text-outline font-bold uppercase tracking-widest text-[10px]"
                        >
                          {col.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {query.result.rows.slice(0, 5).map((row, i) => (
                      <tr
                        key={i}
                        className={i % 2 === 0 ? 'bg-surface' : 'bg-surface-container-low'}
                      >
                        {query.result!.columns.map((col) => (
                          <td key={col.name} className="px-3 py-1.5 text-on-surface-variant">
                            {row[col.name] === null ? (
                              <span className="text-outline italic">NULL</span>
                            ) : (
                              String(row[col.name])
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function QueryCardSkeleton() {
  return (
    <div className="bg-surface-container-low rounded-xl overflow-hidden">
      <div className="flex">
        <div className="w-1.5 shrink-0 bg-surface-container-high" />
        <div className="flex-1 p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="h-5 w-16 bg-surface-container-high rounded animate-pulse" />
            <div className="h-4 w-24 bg-surface-container-high rounded animate-pulse" />
          </div>
          <div className="h-20 bg-surface-container-high rounded-lg animate-pulse" />
          <div className="flex gap-4">
            <div className="h-4 w-12 bg-surface-container-high rounded animate-pulse" />
            <div className="h-4 w-16 bg-surface-container-high rounded animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HistoryPage(_props: ClientPageProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error'>('all');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['query-history', statusFilter, page],
    queryFn: () => queryApi.history(undefined, { page, limit: 20 }),
    staleTime: 30_000,
  });

  const allQueries = data?.items ?? [];
  const filtered = allQueries.filter((q) => {
    if (statusFilter !== 'all' && q.status !== statusFilter) return false;
    if (search && !q.sql.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="page-shell-narrow page-stack">
      {/* Page header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-10">
        <div className="space-y-1.5">
          <h1 className="font-headline text-4xl font-bold tracking-tight text-on-surface">
            Query History
          </h1>
          <p className="text-outline text-sm">
            Review and restore your recent laboratory executions.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-base">
              search
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Find keywords in SQL..."
              className="bg-surface-container-low rounded-lg pl-10 pr-4 py-2 text-sm w-64 focus:ring-1 focus:ring-primary outline-none placeholder:text-outline/60 text-on-surface"
            />
          </div>

          {/* Status filter buttons */}
          <div className="flex items-center gap-1 bg-surface-container-low rounded-xl p-1">
            {(['all', 'success', 'error'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all',
                  statusFilter === s
                    ? 'bg-surface-container-highest text-on-surface'
                    : 'text-on-surface-variant hover:text-on-surface'
                )}
              >
                {s === 'all' ? 'All' : s === 'success' ? 'Successful' : 'Failed'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Query list */}
      <div className="space-y-4">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <QueryCardSkeleton key={i} />)
        ) : filtered.length === 0 ? (
          <div className="bg-surface-container-low rounded-xl p-12 flex flex-col items-center justify-center text-center">
            <span className="material-symbols-outlined text-3xl text-outline mb-3">history</span>
            <p className="text-sm font-medium text-on-surface mb-1">No queries found</p>
            <p className="text-xs text-on-surface-variant">
              {search ? 'Try a different search term.' : 'Run your first SQL query to see it here.'}
            </p>
          </div>
        ) : (
          filtered.map((q) => <QueryCard key={q.id} query={q} />)
        )}
      </div>

      {/* Load more */}
      {!isLoading && filtered.length > 0 && (
        <div className="mt-10 flex items-center justify-between">
          <p className="text-xs text-on-surface-variant">{filtered.length} queries shown</p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={!data?.totalPages || page >= data.totalPages}
              onClick={() => setPage(page + 1)}
              leftIcon={<span className="material-symbols-outlined text-sm">expand_more</span>}
            >
              Load More
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
