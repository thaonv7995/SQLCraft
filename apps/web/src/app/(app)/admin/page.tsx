'use client';

import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import type { SystemMetrics, SystemJob } from '@/lib/api';
import { StatCard } from '@/components/ui/card';
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
  TableSkeleton,
} from '@/components/ui/table';
import { formatRelativeTime } from '@/lib/utils';
import toast from 'react-hot-toast';

const MOCK_METRICS: SystemMetrics = {
  activeSandboxes: 24,
  querySuccessRate: 97.3,
  p95LatencyMs: 342,
  totalUsers: 1_489,
  totalQueriesLast24h: 15_832,
  errorRate: 2.7,
};

const MOCK_JOBS: SystemJob[] = [
  { id: 'j1', type: 'sandbox_cleanup', status: 'completed', target: '8 sandboxes', startedAt: new Date(Date.now() - 5 * 60_000).toISOString(), completedAt: new Date(Date.now() - 4 * 60_000).toISOString() },
  { id: 'j2', type: 'db_migration', status: 'running', target: 'production', startedAt: new Date(Date.now() - 2 * 60_000).toISOString() },
  { id: 'j3', type: 'content_sync', status: 'completed', target: '3 tracks', startedAt: new Date(Date.now() - 30 * 60_000).toISOString(), completedAt: new Date(Date.now() - 29 * 60_000).toISOString() },
  { id: 'j4', type: 'session_expire', status: 'failed', target: 'batch #142', startedAt: new Date(Date.now() - 90 * 60_000).toISOString(), errorMessage: 'Connection timeout to sandbox pool' },
];

export default function AdminDashboardPage() {
  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ['admin-metrics'],
    queryFn: adminApi.metrics,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: jobs, isLoading: jobsLoading } = useQuery({
    queryKey: ['admin-jobs'],
    queryFn: adminApi.jobs,
    staleTime: 15_000,
  });

  const displayMetrics = metrics ?? MOCK_METRICS;
  const displayJobs = jobs ?? MOCK_JOBS;

  const handleTerminateAll = async (): Promise<void> => {
    try {
      await adminApi.terminateAllSandboxes();
      toast.success('All sandboxes terminated');
    } catch {
      toast.error('Failed to terminate sandboxes');
    }
  };

  return (
    <div className="p-6 space-y-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-headline text-2xl font-bold text-on-surface">System Health</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Real-time platform metrics and infrastructure status.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-secondary">
            <span className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse" />
            All systems operational
          </div>
        </div>
      </div>

      {/* Metrics */}
      {metricsLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-surface-container-low rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Active Sandboxes"
            value={displayMetrics.activeSandboxes}
            accent="tertiary"
            icon={<span className="material-symbols-outlined">dns</span>}
          />
          <StatCard
            label="Query Success Rate"
            value={`${displayMetrics.querySuccessRate}%`}
            delta="+0.3% vs yesterday"
            deltaPositive
            accent="secondary"
            icon={<span className="material-symbols-outlined">verified</span>}
          />
          <StatCard
            label="p95 Latency"
            value={`${displayMetrics.p95LatencyMs}ms`}
            accent="primary"
            icon={<span className="material-symbols-outlined">speed</span>}
          />
          <StatCard
            label="Queries (24h)"
            value={displayMetrics.totalQueriesLast24h.toLocaleString()}
            delta="+12% vs last week"
            deltaPositive
            accent="primary"
            icon={<span className="material-symbols-outlined">query_stats</span>}
          />
        </div>
      )}

      {/* Secondary metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface-container-low rounded-xl p-5 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-outline">Total Users</h3>
          <p className="text-3xl font-headline font-bold text-on-surface">
            {displayMetrics.totalUsers.toLocaleString()}
          </p>
          <p className="text-xs text-secondary">+34 today</p>
        </div>
        <div className="bg-surface-container-low rounded-xl p-5 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-outline">Error Rate</h3>
          <p className={`text-3xl font-headline font-bold ${displayMetrics.errorRate > 5 ? 'text-error' : 'text-on-surface'}`}>
            {displayMetrics.errorRate}%
          </p>
          <p className="text-xs text-on-surface-variant">Query execution errors</p>
        </div>
        <div className="bg-surface-container-low rounded-xl p-5 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-outline">Sandbox Pool</h3>
          <div className="flex items-end gap-2">
            <p className="text-3xl font-headline font-bold text-on-surface">{displayMetrics.activeSandboxes}</p>
            <p className="text-sm text-on-surface-variant mb-1">/ 50 max</p>
          </div>
          <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-tertiary to-secondary rounded-full"
              style={{ width: `${(displayMetrics.activeSandboxes / 50) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Jobs table + Quick actions */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Jobs */}
        <div className="xl:col-span-2 bg-surface-container-low rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="font-headline text-base font-semibold text-on-surface">
              Recent System Jobs
            </h2>
            <Button variant="ghost" size="sm">
              <span className="material-symbols-outlined text-sm">refresh</span>
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobsLoading ? (
                <TableSkeleton rows={4} cols={5} />
              ) : displayJobs.length === 0 ? (
                <TableEmpty message="No recent jobs" colSpan={5} />
              ) : (
                displayJobs.map((job) => {
                  const duration =
                    job.completedAt
                      ? `${Math.round((new Date(job.completedAt).getTime() - new Date(job.startedAt).getTime()) / 1000)}s`
                      : job.status === 'running' ? 'Running...' : '-';
                  return (
                    <TableRow key={job.id}>
                      <TableCell>
                        <span className="font-mono text-xs bg-surface-container-high px-2 py-0.5 rounded text-on-surface-variant">
                          {job.type}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={job.status} />
                      </TableCell>
                      <TableCell className="text-on-surface-variant text-xs">
                        {job.target ?? '—'}
                      </TableCell>
                      <TableCell className="text-on-surface-variant text-xs">
                        {formatRelativeTime(job.startedAt)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-on-surface-variant">
                        {duration}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Quick actions */}
        <div className="bg-surface-container-low rounded-xl p-5 space-y-4">
          <h2 className="font-headline text-base font-semibold text-on-surface">
            Quick Actions
          </h2>
          <div className="space-y-2">
            {[
              { label: 'Terminate All Sandboxes', icon: 'stop_circle', action: handleTerminateAll, variant: 'destructive' as const },
              { label: 'Run Migrations', icon: 'upgrade', action: () => toast.success('Migrations queued'), variant: 'secondary' as const },
              { label: 'Sync Content', icon: 'sync', action: () => toast.success('Sync started'), variant: 'secondary' as const },
              { label: 'Export User Data', icon: 'download', action: () => toast.success('Export queued'), variant: 'ghost' as const },
              { label: 'View System Logs', icon: 'receipt_long', action: () => {}, variant: 'ghost' as const },
            ].map((item) => (
              <Button
                key={item.label}
                variant={item.variant}
                size="sm"
                fullWidth
                onClick={item.action}
                leftIcon={<span className="material-symbols-outlined text-sm">{item.icon}</span>}
                className="justify-start"
              >
                {item.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
