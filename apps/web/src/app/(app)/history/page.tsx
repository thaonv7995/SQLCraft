'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryApi } from '@/lib/api';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
  TableEmpty,
  TableSkeleton,
} from '@/components/ui/table';
import { formatDuration, formatRelativeTime, formatRows, truncateSql, classifyQueryType } from '@/lib/utils';
import { cn } from '@/lib/utils';
import type { QueryExecution } from '@/lib/api';


const QUERY_TYPE_COLORS: Record<string, string> = {
  SELECT: 'text-primary',
  INSERT: 'text-secondary',
  UPDATE: 'text-tertiary',
  DELETE: 'text-error',
  CREATE: 'text-on-surface-variant',
  DROP: 'text-error',
  ALTER: 'text-on-surface-variant',
  EXPLAIN: 'text-outline',
  QUERY: 'text-outline',
};

function ExpandedQueryRow({ query }: { query: QueryExecution }) {
  return (
    <div className="px-4 py-4 bg-surface-container space-y-4">
      {/* Full SQL */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-outline mb-2">
          Full Query
        </p>
        <pre className="text-xs font-mono text-on-surface-variant bg-surface-container-lowest rounded-xl p-4 overflow-x-auto whitespace-pre-wrap">
          {query.sql}
        </pre>
      </div>

      {/* Error */}
      {query.errorMessage && (
        <div className="flex gap-2.5 bg-error/10 rounded-xl p-3">
          <span className="material-symbols-outlined text-error text-sm shrink-0">error</span>
          <p className="text-xs font-mono text-error">{query.errorMessage}</p>
        </div>
      )}

      {/* Execution Plan placeholder */}
      {query.executionPlan && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-outline mb-2">
            Execution Plan
          </p>
          <pre className="text-xs font-mono text-on-surface-variant bg-surface-container-lowest rounded-xl p-4 overflow-x-auto">
            {JSON.stringify(query.executionPlan.plan, null, 2)}
          </pre>
        </div>
      )}

      {/* Results preview */}
      {query.result && query.result.rows.length > 0 && (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-outline mb-2">
            Result Preview ({query.result.rows.length} rows)
          </p>
          <div className="overflow-x-auto rounded-xl bg-surface-container-high">
            <table className="text-xs font-mono min-w-full">
              <thead className="bg-surface-container-high">
                <tr>
                  {query.result.columns.map((col) => (
                    <th key={col.name} className="px-3 py-2 text-left text-on-surface-variant font-medium uppercase">
                      {col.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {query.result.rows.slice(0, 5).map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-surface' : 'bg-surface-container-low'}>
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
  );
}

export default function HistoryPage() {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'error' | 'running'>('all');
  const [page, setPage] = useState<number>(1);

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
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="font-headline text-2xl font-bold text-on-surface">Query History</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          All your SQL executions across all sessions.
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          placeholder="Search queries..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          leftIcon={<span className="material-symbols-outlined text-sm">search</span>}
          className="max-w-xs"
        />

        <Select
          options={[
            { value: 'all', label: 'All Status' },
            { value: 'success', label: 'Success' },
            { value: 'error', label: 'Error' },
            { value: 'running', label: 'Running' },
          ]}
          value={statusFilter}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
            setStatusFilter(e.target.value as 'all' | 'success' | 'error' | 'running')
          }
          className="max-w-[160px]"
        />
      </div>

      {/* Table */}
      <div className="bg-surface-container-low rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Type</TableHead>
              <TableHead>Query Preview</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Rows</TableHead>
              <TableHead>Timestamp</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableSkeleton rows={5} cols={7} />
            ) : filtered.length === 0 ? (
              <TableEmpty message="No queries found" colSpan={7} />
            ) : (
              filtered.map((q) => {
                const qType = classifyQueryType(q.sql);
                const isExpanded = expandedId === q.id;

                return (
                  <React.Fragment key={q.id}>
                    <TableRow
                      className={cn('cursor-pointer', isExpanded && 'bg-surface-container!')}
                      onClick={() => setExpandedId(isExpanded ? null : q.id)}
                    >
                      {/* Type */}
                      <TableCell>
                        <span
                          className={cn(
                            'text-xs font-mono font-bold',
                            QUERY_TYPE_COLORS[qType] ?? 'text-outline'
                          )}
                        >
                          {qType}
                        </span>
                      </TableCell>

                      {/* SQL Preview */}
                      <TableCell className="max-w-xs">
                        <code className="text-xs font-mono text-on-surface-variant">
                          {truncateSql(q.sql, 60)}
                        </code>
                      </TableCell>

                      {/* Status */}
                      <TableCell>
                        <StatusBadge status={q.status} />
                      </TableCell>

                      {/* Duration */}
                      <TableCell className="font-mono text-xs text-on-surface-variant">
                        {q.durationMs !== undefined ? formatDuration(q.durationMs) : '—'}
                      </TableCell>

                      {/* Rows */}
                      <TableCell className="font-mono text-xs text-on-surface-variant">
                        {q.rowCount !== undefined ? formatRows(q.rowCount) : '—'}
                      </TableCell>

                      {/* Timestamp */}
                      <TableCell className="text-xs text-on-surface-variant whitespace-nowrap">
                        {formatRelativeTime(q.createdAt)}
                      </TableCell>

                      {/* Expand */}
                      <TableCell>
                        <span
                          className={cn(
                            'material-symbols-outlined text-base text-on-surface-variant transition-transform',
                            isExpanded && 'rotate-180'
                          )}
                        >
                          expand_more
                        </span>
                      </TableCell>
                    </TableRow>

                    {/* Expanded row */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={7} className="p-0">
                          <ExpandedQueryRow query={q} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Pagination */}
        <div className="flex items-center justify-between px-5 py-3 bg-surface-container/30">
          <p className="text-xs text-on-surface-variant">
            {filtered.length} queries shown
          </p>
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
            >
              Next
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
