'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { StatusBadge } from '@/components/ui/badge';
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

type SystemTab = 'health' | 'queues' | 'logs' | 'resources';
type QueueFilter = 'all' | 'pending' | 'running' | 'completed' | 'failed' | 'retrying';

const TAB_OPTIONS: Array<{ id: SystemTab; label: string; icon: string }> = [
  { id: 'health', label: 'Health', icon: 'monitoring' },
  { id: 'queues', label: 'Queues', icon: 'account_tree' },
  { id: 'logs', label: 'Logs', icon: 'receipt_long' },
  { id: 'resources', label: 'Resources', icon: 'memory' },
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

export default function AdminSystemPage() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams?.get('tab') ?? null;
  const [activeTab, setActiveTab] = useState<SystemTab>(
    isSystemTab(requestedTab) ? requestedTab : 'health',
  );
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('all');

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
            Operational console for platform health, queue execution, logs, and resource posture.
            This page is frontend-only and uses currently available admin health/job endpoints.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Health</p>
            <div className="mt-2">
              <StatusBadge status={health ? health.status : 'pending'} />
            </div>
          </div>
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Queue Backlog</p>
            <p className="mt-2 text-xl font-semibold text-on-surface">{pendingJobs}</p>
          </div>
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Active Sessions</p>
            <p className="mt-2 text-xl font-semibold text-on-surface">{activeSessions}</p>
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
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Users</p>
            <p className="mt-2 text-2xl font-semibold text-on-surface">{totalUsers}</p>
          </div>
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Tracks</p>
            <p className="mt-2 text-2xl font-semibold text-on-surface">{totalTracks}</p>
          </div>
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Lessons</p>
            <p className="mt-2 text-2xl font-semibold text-on-surface">{totalLessons}</p>
          </div>
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-4">
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Timestamp</p>
            <p className="mt-2 text-sm text-on-surface">
              {health ? formatRelativeTime(health.timestamp) : 'Awaiting health payload'}
            </p>
          </div>
        </section>
      ) : null}

      {activeTab === 'queues' ? (
        <section className="section-card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-outline-variant/10 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="page-section-title">Job Queues</h2>
              <p className="text-xs text-on-surface-variant">
                Backed by `/admin/system/jobs` and filtered client-side.
              </p>
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
          <h2 className="page-section-title">Logs</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Full log ingestion for this tab is staged. Legacy routes such as `/admin/health/logs`
            now land on this tab so the navigation model stays consistent while audit-log APIs are
            still being wired.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Link
              href="/docs"
              className="inline-flex items-center gap-2 rounded-lg border border-outline-variant/20 bg-surface-container-low px-3 py-2 text-sm text-on-surface hover:bg-surface-container"
            >
              <span className="material-symbols-outlined text-sm">menu_book</span>
              Open Admin Docs
            </Link>
            <span className="rounded-full bg-surface px-2 py-1 text-xs text-on-surface-variant">
              audit API staged
            </span>
          </div>
        </section>
      ) : null}

      {activeTab === 'resources' ? (
        <section className="section-card p-5">
          <h2 className="page-section-title">Resources</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Resource indicators are derived from available health and queue stats until dedicated
            infra telemetry APIs are connected.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Session Capacity</p>
              <p className="mt-2 text-sm text-on-surface">
                {activeSessions} active sessions are currently running.
              </p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-container-high">
                <div
                  className="h-full rounded-full bg-on-surface-variant"
                  style={{ width: `${Math.min((activeSessions / 50) * 100, 100)}%` }}
                />
              </div>
            </div>
            <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Queue Pressure</p>
              <p className="mt-2 text-sm text-on-surface">
                {pendingJobs} pending jobs and {queueCounters.running} running workers.
              </p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-container-high">
                <div
                  className="h-full rounded-full bg-tertiary"
                  style={{ width: `${Math.min((pendingJobs / 40) * 100, 100)}%` }}
                />
              </div>
            </div>
            <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Reliability</p>
              <p className="mt-2 text-sm text-on-surface">
                {queueCounters.failed} failed jobs detected in the latest queue snapshot.
              </p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-container-high">
                <div
                  className="h-full rounded-full bg-error"
                  style={{ width: `${Math.min((queueCounters.failed / 20) * 100, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
