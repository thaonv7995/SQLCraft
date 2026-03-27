'use client';

import { useMemo, useState } from 'react';
import { searchParamFirst } from '@/lib/next-app-page';
import type { ClientPageProps } from '@/lib/page-props';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { adminApi } from '@/lib/api';
import { AdminConfigPanel } from '@/components/admin/admin-config-panel';
import { StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableSkeleton,
} from '@/components/ui/table';
import { formatRelativeTime } from '@/lib/utils';

function formatAuditPayloadPreview(payload: unknown): string {
  if (payload == null) return '—';
  try {
    const s = JSON.stringify(payload);
    return s.length > 140 ? `${s.slice(0, 137)}…` : s;
  } catch {
    return String(payload);
  }
}

type SystemTab = 'health' | 'queues' | 'logs' | 'resources' | 'config';
type QueueFilter = 'all' | 'pending' | 'running' | 'completed' | 'failed' | 'retrying';

const TAB_OPTIONS: Array<{ id: SystemTab; label: string; icon: string }> = [
  { id: 'health', label: 'Health', icon: 'monitoring' },
  { id: 'queues', label: 'Queues', icon: 'account_tree' },
  { id: 'logs', label: 'Logs', icon: 'receipt_long' },
  { id: 'resources', label: 'Resources', icon: 'memory' },
  { id: 'config', label: 'Config', icon: 'tune' },
];

const FILTER_OPTIONS: QueueFilter[] = [
  'all',
  'pending',
  'running',
  'completed',
  'failed',
  'retrying',
];

const EMPTY_JOBS: Awaited<ReturnType<typeof adminApi.systemJobs>> = [];
const SYSTEM_TABS = TAB_OPTIONS.map((tab) => tab.id);

const isSystemTab = (value: string | null): value is SystemTab =>
  value !== null && SYSTEM_TABS.includes(value as SystemTab);

export default function AdminSystemPage({ searchParams }: ClientPageProps) {
  const queryClient = useQueryClient();
  const requestedTab = searchParamFirst(searchParams, 'tab');
  const [activeTab, setActiveTab] = useState<SystemTab>(
    isSystemTab(requestedTab) ? requestedTab : 'health',
  );
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all');
  const [auditPage, setAuditPage] = useState(1);
  const [auditActionDraft, setAuditActionDraft] = useState('');
  const [auditResourceDraft, setAuditResourceDraft] = useState('');
  const [auditFilters, setAuditFilters] = useState<{ action: string; resourceType: string }>({
    action: '',
    resourceType: '',
  });

  const healthQuery = useQuery({
    queryKey: ['admin-system-health-page'],
    queryFn: adminApi.systemHealth,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const jobsQuery = useQuery({
    queryKey: ['admin-system-jobs-page'],
    queryFn: () => adminApi.systemJobs({ limit: 50 }),
    staleTime: 15_000,
  });

  const auditLogsQuery = useQuery({
    queryKey: ['admin-system-audit-logs', auditPage, auditFilters.action, auditFilters.resourceType],
    queryFn: () =>
      adminApi.auditLogs({
        page: auditPage,
        limit: 25,
        ...(auditFilters.action.trim() ? { action: auditFilters.action.trim() } : {}),
        ...(auditFilters.resourceType.trim()
          ? { resourceType: auditFilters.resourceType.trim() }
          : {}),
      }),
    enabled: activeTab === 'logs',
    staleTime: 15_000,
  });

  const clearStaleSessionsMutation = useMutation({
    mutationFn: () => adminApi.clearStaleSessions(),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-system-health-page'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-system-health-dashboard'] }),
        queryClient.invalidateQueries({ queryKey: ['sessions'] }),
      ]);

      if (result.clearedCount === 0) {
        toast.success('No stale sessions found');
        return;
      }

      toast.success(`Cleared ${result.clearedCount} stale session${result.clearedCount === 1 ? '' : 's'}`);
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Failed to clear stale sessions');
    },
  });

  const health = healthQuery.data;
  const jobs = jobsQuery.data ?? EMPTY_JOBS;

  const filteredJobs = useMemo(() => {
    if (queueFilter === 'all') {
      return jobs;
    }
    return jobs.filter((job) => job.status === queueFilter);
  }, [jobs, queueFilter]);

  const queueCounters = useMemo(() => {
    return {
      pending: jobs.filter((job) => job.status === 'pending').length,
      running: jobs.filter((job) => job.status === 'running').length,
      failed: jobs.filter((job) => job.status === 'failed').length,
      completed: jobs.filter((job) => job.status === 'completed').length,
    };
  }, [jobs]);

  const totalUsers = health?.stats.users ?? 0;
  const totalTracks = health?.stats.tracks ?? 0;
  const totalLessons = health?.stats.lessons ?? 0;
  const activeSessions = health?.stats.activeSessions ?? 0;
  const pendingJobs = health?.stats.pendingJobs ?? queueCounters.pending;

  return (
    <div className="page-shell-wide page-stack">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-on-surface-variant">System</p>
          <h1 className="mt-2 page-title-lg">System Operations</h1>
          <p className="page-lead mt-2 max-w-3xl">
            Operational console for platform health, queue execution, logs, resource posture, and
            persisted admin config.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <div className="min-w-[7.5rem] max-w-[11rem] rounded-lg border border-outline-variant/10 bg-surface-container-low px-3 py-2.5">
            <p className="text-[10px] font-medium uppercase leading-tight tracking-wide text-outline">
              Health
            </p>
            <div className="mt-1.5">
              <StatusBadge
                status={
                  healthQuery.isError
                    ? 'error'
                    : healthQuery.isLoading && !health
                      ? 'pending'
                      : health
                        ? health.status
                        : 'pending'
                }
              />
            </div>
          </div>
          <div className="min-w-[6.25rem] max-w-[9rem] rounded-lg border border-outline-variant/10 bg-surface-container-low px-2.5 py-2">
            <p className="text-[10px] font-medium uppercase leading-tight tracking-wide text-outline">
              Queue Backlog
            </p>
            <p className="mt-1 text-base font-semibold tabular-nums leading-none text-on-surface">
              {pendingJobs}
            </p>
          </div>
          <div className="min-w-[6.25rem] max-w-[9rem] rounded-lg border border-outline-variant/10 bg-surface-container-low px-2.5 py-2">
            <p className="text-[10px] font-medium uppercase leading-tight tracking-wide text-outline">
              Active Sessions
            </p>
            <p className="mt-1 text-base font-semibold tabular-nums leading-none text-on-surface">
              {activeSessions}
            </p>
          </div>
        </div>
      </div>

      <div className="section-card p-4">
        <div className="flex flex-wrap items-center gap-2">
          {TAB_OPTIONS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-surface-container-high text-on-surface'
                  : 'bg-surface text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined text-sm">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'health' ? (
        <div className="space-y-4">
          <section className="section-card flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <h2 className="page-section-title">Session Recovery</h2>
              <p className="mt-1 text-sm text-on-surface-variant">
                Manually expire stale lab sessions older than 2 hours and enqueue sandbox cleanup
                for anything stuck in provisioning or paused states.
              </p>
            </div>

            <Button
              variant="destructive"
              onClick={() => clearStaleSessionsMutation.mutate()}
              loading={clearStaleSessionsMutation.isPending}
            >
              Clear Stale Sessions
            </Button>
          </section>

          <section className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border border-outline-variant/10 bg-surface-container-low px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase leading-tight tracking-wide text-outline">
                Users
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums leading-none text-on-surface">
                {totalUsers}
              </p>
            </div>
            <div className="rounded-lg border border-outline-variant/10 bg-surface-container-low px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase leading-tight tracking-wide text-outline">
                Tracks
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums leading-none text-on-surface">
                {totalTracks}
              </p>
            </div>
            <div className="rounded-lg border border-outline-variant/10 bg-surface-container-low px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase leading-tight tracking-wide text-outline">
                Lessons
              </p>
              <p className="mt-1 text-lg font-semibold tabular-nums leading-none text-on-surface">
                {totalLessons}
              </p>
            </div>
            <div className="rounded-lg border border-outline-variant/10 bg-surface-container-low px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase leading-tight tracking-wide text-outline">
                Timestamp
              </p>
              <p className="mt-1 text-xs leading-snug text-on-surface">
                {health ? formatRelativeTime(health.timestamp) : 'Awaiting health payload'}
              </p>
            </div>
          </section>
        </div>
      ) : null}

      {activeTab === 'queues' ? (
        <section className="section-card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-outline-variant/10 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="page-section-title">Job Queues</h2>
            </div>
            <div className="flex flex-wrap gap-2">
              {FILTER_OPTIONS.map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setQueueFilter(filter)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    queueFilter === filter
                      ? 'bg-surface-container-high text-on-surface'
                      : 'bg-surface text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 border-b border-outline-variant/10 px-5 py-3 text-xs text-on-surface-variant sm:grid-cols-4">
            <span>Pending: {queueCounters.pending}</span>
            <span>Running: {queueCounters.running}</span>
            <span>Failed: {queueCounters.failed}</span>
            <span>Completed: {queueCounters.completed}</span>
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
              {jobsQuery.isLoading ? (
                <TableSkeleton rows={8} cols={5} />
              ) : jobsQuery.isError ? (
                <TableEmpty
                  message="Queue endpoint is not available in this environment."
                  colSpan={5}
                />
              ) : filteredJobs.length === 0 ? (
                <TableEmpty message="No jobs for this filter." colSpan={5} />
              ) : (
                filteredJobs.map((job) => {
                  const completedAt = job.completedAt ? new Date(job.completedAt).getTime() : null;
                  const startedAt = new Date(job.startedAt).getTime();
                  const durationSeconds =
                    completedAt == null ? null : Math.max(Math.round((completedAt - startedAt) / 1000), 0);

                  return (
                    <TableRow key={job.id}>
                      <TableCell>
                        <span className="rounded bg-surface-container-high px-2 py-0.5 font-mono text-xs text-on-surface-variant">
                          {job.type}
                        </span>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={job.status} />
                      </TableCell>
                      <TableCell className="text-xs text-on-surface-variant">
                        {job.target ?? '—'}
                      </TableCell>
                      <TableCell className="text-xs text-on-surface-variant">
                        {formatRelativeTime(job.startedAt)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-on-surface-variant">
                        {durationSeconds == null
                          ? job.status === 'running'
                            ? 'Running...'
                            : '—'
                          : `${durationSeconds}s`}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </section>
      ) : null}

      {activeTab === 'logs' ? (
        <section className="section-card p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="page-section-title">Audit log</h2>
              <p className="mt-1 max-w-3xl text-sm text-on-surface-variant">
                Immutable-style trail of sensitive admin actions (config changes, session cleanup,
                database deletes). Filter by exact <span className="font-mono text-xs">action</span>{' '}
                or <span className="font-mono text-xs">resourceType</span> when you need to narrow
                results.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              type="button"
              onClick={() => auditLogsQuery.refetch()}
              loading={auditLogsQuery.isFetching}
              leftIcon={<span className="material-symbols-outlined text-base">refresh</span>}
            >
              Refresh
            </Button>
          </div>

          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
            <Input
              label="Action (exact)"
              className="lg:max-w-xs"
              placeholder="e.g. admin.config.update"
              value={auditActionDraft}
              onChange={(e) => setAuditActionDraft(e.target.value)}
            />
            <Input
              label="Resource type (exact)"
              className="lg:max-w-xs"
              placeholder="e.g. admin_config"
              value={auditResourceDraft}
              onChange={(e) => setAuditResourceDraft(e.target.value)}
            />
            <Button
              type="button"
              onClick={() => {
                setAuditPage(1);
                setAuditFilters({
                  action: auditActionDraft.trim(),
                  resourceType: auditResourceDraft.trim(),
                });
              }}
            >
              Apply filters
            </Button>
          </div>

          <div className="mt-4 overflow-x-auto rounded-xl border border-outline-variant/10">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>IP</TableHead>
                  <TableHead>Payload</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditLogsQuery.isLoading ? (
                  <TableSkeleton rows={6} cols={6} />
                ) : auditLogsQuery.isError ? (
                  <TableEmpty
                    message="Could not load audit logs. Check that the API is running and you are signed in as admin."
                    colSpan={6}
                  />
                ) : !auditLogsQuery.data?.items.length ? (
                  <TableEmpty
                    message="No audit entries yet. Actions such as saving admin config, clearing stale sessions, or deleting a catalog database will appear here."
                    colSpan={6}
                  />
                ) : (
                  auditLogsQuery.data.items.map((row) => {
                    const actor =
                      row.actorUsername?.trim() ||
                      row.actorEmail?.trim() ||
                      (row.userId ? `${row.userId.slice(0, 8)}…` : null);
                    const resource =
                      row.resourceType || row.resourceId
                        ? [row.resourceType, row.resourceId].filter(Boolean).join(' · ')
                        : '—';
                    const preview = formatAuditPayloadPreview(row.payload);
                    const fullPayload =
                      row.payload == null ? '' : JSON.stringify(row.payload, null, 2);

                    return (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap text-xs text-on-surface-variant">
                          {formatRelativeTime(row.createdAt)}
                        </TableCell>
                        <TableCell className="text-xs text-on-surface">{actor ?? '—'}</TableCell>
                        <TableCell>
                          <span className="rounded bg-surface-container-high px-2 py-0.5 font-mono text-[11px] text-on-surface-variant">
                            {row.action}
                          </span>
                        </TableCell>
                        <TableCell className="max-w-[12rem] truncate text-xs text-on-surface-variant">
                          {resource}
                        </TableCell>
                        <TableCell className="font-mono text-[11px] text-on-surface-variant">
                          {row.ipAddress ?? '—'}
                        </TableCell>
                        <TableCell
                          className="max-w-[20rem] truncate text-xs text-on-surface-variant"
                          title={fullPayload || undefined}
                        >
                          {preview}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {auditLogsQuery.data && auditLogsQuery.data.total > 0 ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-on-surface-variant">
                Page {auditLogsQuery.data.page} of {auditLogsQuery.data.totalPages} ·{' '}
                {auditLogsQuery.data.total} total
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={auditPage <= 1 || auditLogsQuery.isFetching}
                  onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={
                    auditPage >= auditLogsQuery.data.totalPages || auditLogsQuery.isFetching
                  }
                  onClick={() => setAuditPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === 'resources' ? (
        <section className="section-card p-5">
          <h2 className="page-section-title">Resources</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Resource indicators are derived from available health and queue stats until dedicated
            infra telemetry APIs are connected.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-2 lg:grid-cols-3">
            <div className="rounded-lg border border-outline-variant/10 bg-surface-container-low px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase leading-tight tracking-wide text-outline">
                Session Capacity
              </p>
              <p className="mt-1 text-xs leading-snug text-on-surface">
                {activeSessions} active sessions are currently running.
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-container-high">
                <div
                  className="h-full rounded-full bg-on-surface-variant"
                  style={{ width: `${Math.min((activeSessions / 50) * 100, 100)}%` }}
                />
              </div>
            </div>
            <div className="rounded-lg border border-outline-variant/10 bg-surface-container-low px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase leading-tight tracking-wide text-outline">
                Queue Pressure
              </p>
              <p className="mt-1 text-xs leading-snug text-on-surface">
                {pendingJobs} pending jobs and {queueCounters.running} running workers.
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-container-high">
                <div
                  className="h-full rounded-full bg-tertiary"
                  style={{ width: `${Math.min((pendingJobs / 40) * 100, 100)}%` }}
                />
              </div>
            </div>
            <div className="rounded-lg border border-outline-variant/10 bg-surface-container-low px-3 py-2.5">
              <p className="text-[10px] font-medium uppercase leading-tight tracking-wide text-outline">
                Reliability
              </p>
              <p className="mt-1 text-xs leading-snug text-on-surface">
                {queueCounters.failed} failed jobs detected in the latest queue snapshot.
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-container-high">
                <div
                  className="h-full rounded-full bg-error"
                  style={{ width: `${Math.min((queueCounters.failed / 20) * 100, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === 'config' ? <AdminConfigPanel /> : null}
    </div>
  );
}
