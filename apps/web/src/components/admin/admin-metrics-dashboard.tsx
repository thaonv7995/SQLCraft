'use client';

import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { StatusBadge } from '@/components/ui/badge';
import { Button, type ButtonVariant } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, StatCard } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatRelativeTime } from '@/lib/utils';
import toast from 'react-hot-toast';

interface AdminMetricsDashboardProps {
  variant: 'overview' | 'health';
}

interface QuickAction {
  label: string;
  icon: string;
  variant: ButtonVariant;
  href?: string;
  action?: () => void | Promise<void>;
}

export function AdminMetricsDashboard({ variant }: AdminMetricsDashboardProps) {
  const router = useRouter();

  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ['admin-system-health-dashboard'],
    queryFn: adminApi.systemHealth,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: jobs, isPending: jobsPending, isFetching: jobsFetching } = useQuery({
    queryKey: ['admin-jobs-dashboard'],
    queryFn: () => adminApi.systemJobs({ limit: 8 }),
    staleTime: 15_000,
  });

  const displayJobs = jobs ?? [];
  const pendingJobs =
    health?.stats.pendingJobs ?? displayJobs.filter((job) => job.status === 'pending').length;
  const runningJobs = displayJobs.filter((job) => job.status === 'running').length;
  const failedJobs = displayJobs.filter((job) => job.status === 'failed').length;
  const attentionStatus = failedJobs > 0 ? 'failed' : pendingJobs > 0 ? 'pending' : 'completed';

  const handleTerminateAll = async (): Promise<void> => {
    try {
      await adminApi.terminateAllSandboxes();
      toast.success('All sandboxes terminated');
    } catch {
      toast.error('Failed to terminate sandboxes');
    }
  };

  const heading = variant === 'overview' ? 'Overview' : 'System Health';
  const description =
    variant === 'overview'
      ? 'Operational snapshot for queue pressure, worker health, and live admin load.'
      : 'Real-time infrastructure status for sessions, queue pressure, and content inventory.';
  const statusLabel =
    variant === 'overview' ? 'Operational view live' : 'System telemetry live';

  const quickActions: QuickAction[] = [
    {
      label: 'Terminate All Sandboxes',
      icon: 'stop_circle',
      action: handleTerminateAll,
      variant: 'destructive',
    },
    {
      label: 'Open Queues',
      icon: 'account_tree',
      href: '/admin/system?tab=queues',
      variant: 'secondary',
    },
    {
      label: 'Review SQL Imports',
      icon: 'upload_file',
      href: '/admin/databases?view=import',
      variant: 'secondary',
    },
    {
      label: 'Open Logs',
      icon: 'receipt_long',
      href: '/admin/system?tab=logs',
      variant: 'ghost',
    },
  ];

  return (
    <div className="page-shell-wide page-stack">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-title">{heading}</h1>
          <p className="page-lead mt-1">{description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-on-surface-variant">
            <span className="w-1.5 h-1.5 rounded-full bg-on-surface-variant animate-pulse" />
            {statusLabel}
          </div>
        </div>
      </div>

      {healthLoading || !health ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[1, 2, 3, 4].map((index) => (
            <div key={index} className="h-24 animate-pulse rounded-xl bg-surface-container-low" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Failed Jobs"
            value={failedJobs}
            accent={failedJobs > 0 ? 'error' : 'secondary'}
            icon={<span className="material-symbols-outlined">error</span>}
          />
          <StatCard
            label="Pending Jobs"
            value={pendingJobs}
            accent="primary"
            icon={<span className="material-symbols-outlined">account_tree</span>}
          />
          <StatCard
            label="Running Jobs"
            value={runningJobs}
            accent="tertiary"
            icon={<span className="material-symbols-outlined">sync</span>}
          />
          <StatCard
            label="Active Sessions"
            value={health.stats.activeSessions}
            accent="secondary"
            icon={<span className="material-symbols-outlined">dns</span>}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.9fr_1fr]">
        <div className="overflow-hidden rounded-xl bg-surface-container-low">
          <div className="flex items-center justify-between gap-3 px-5 py-4">
            <h2 className="font-headline text-base font-semibold text-on-surface">
              Recent Worker Jobs
            </h2>
            {jobsFetching && !jobsPending ? (
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-on-surface-variant flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-on-surface-variant animate-pulse" />
                Refreshing
              </span>
            ) : null}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobsPending ? (
                <TableRow>
                  <TableCell colSpan={4} className="py-9 text-center">
                    <p className="text-xs text-on-surface-variant">
                      Loading recent jobs…
                    </p>
                  </TableCell>
                </TableRow>
              ) : displayJobs.length === 0 ? (
                <TableEmpty message="No recent jobs" colSpan={4} />
              ) : (
                displayJobs.map((job) => {
                  const duration = job.completedAt
                    ? `${Math.round(
                        (new Date(job.completedAt).getTime() -
                          new Date(job.startedAt).getTime()) /
                          1000,
                      )}s`
                    : job.status === 'running'
                      ? 'Running...'
                      : '—';

                  return (
                    <TableRow key={job.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <span className="inline-flex rounded bg-surface-container-high px-2 py-0.5 font-mono text-xs text-on-surface-variant">
                            {job.type}
                          </span>
                          <p className="truncate text-xs text-on-surface-variant">
                            {job.target ?? 'No target'}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={job.status} />
                      </TableCell>
                      <TableCell className="text-xs text-on-surface-variant">
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

        <div className="space-y-6">
          {variant === 'overview' ? (
            <Card className="rounded-xl border border-outline-variant/10">
              <CardHeader className="flex-col items-start gap-2 px-5 py-4">
                <div>
                  <CardTitle>Needs Attention</CardTitle>
                  <CardDescription className="mt-1">
                    A short operational read so the overview stays scannable.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5 pt-0">
                <div className="flex items-center justify-between rounded-xl bg-surface-container px-3 py-2.5">
                  <span className="text-sm text-on-surface">Overall status</span>
                  <StatusBadge status={attentionStatus} />
                </div>
                <div className="rounded-xl bg-surface-container px-3 py-3">
                  <p className="text-sm font-medium text-on-surface">
                    {failedJobs > 0
                      ? 'Recent worker failures need review.'
                      : 'No recent worker failures.'}
                  </p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    {failedJobs > 0
                      ? `${failedJobs} failed job${failedJobs === 1 ? '' : 's'} detected in the latest worker activity.`
                      : 'The latest worker activity completed without recorded failures.'}
                  </p>
                </div>
                <div className="rounded-xl bg-surface-container px-3 py-3">
                  <p className="text-sm font-medium text-on-surface">
                    {pendingJobs > 0
                      ? 'Queue backlog is building.'
                      : 'Queue backlog is clear.'}
                  </p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    {pendingJobs > 0
                      ? `${pendingJobs} job${pendingJobs === 1 ? '' : 's'} waiting to be picked up.`
                      : 'No queued jobs are waiting at the moment.'}
                  </p>
                </div>
                <div className="rounded-xl bg-surface-container px-3 py-3">
                  <p className="text-sm font-medium text-on-surface">Live platform load</p>
                  <p className="mt-1 text-xs text-on-surface-variant">
                    {healthLoading || !health
                      ? 'Health metrics are still loading.'
                      : `${health.stats.activeSessions} active session${health.stats.activeSessions === 1 ? '' : 's'} and ${runningJobs} running job${runningJobs === 1 ? '' : 's'} right now.`}
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="rounded-xl border border-outline-variant/10">
              <CardHeader className="flex-col items-start gap-2 px-5 py-4">
                <div>
                  <CardTitle>System Summary</CardTitle>
                  <CardDescription className="mt-1">
                    High-level health state for sessions and worker backlog.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5 pt-0">
                <div className="flex items-center justify-between rounded-xl bg-surface-container px-3 py-2.5">
                  <span className="text-sm text-on-surface">Health Status</span>
                  <StatusBadge status={health?.status ?? 'pending'} />
                </div>
                <div className="flex items-center justify-between rounded-xl bg-surface-container px-3 py-2.5">
                  <span className="text-sm text-on-surface">Queue Backlog</span>
                  <span className="font-mono text-sm text-on-surface">{pendingJobs}</span>
                </div>
                <div className="flex items-center justify-between rounded-xl bg-surface-container px-3 py-2.5">
                  <span className="text-sm text-on-surface">Active Sessions</span>
                  <span className="font-mono text-sm text-on-surface">
                    {health?.stats.activeSessions ?? 0}
                  </span>
                </div>
              </CardContent>
            </Card>
          )}

          {variant === 'health' ? (
            <div className="rounded-xl bg-surface-container-low p-5 space-y-4">
              <h2 className="font-headline text-base font-semibold text-on-surface">
                Quick Actions
              </h2>
              <div className="space-y-2">
                {quickActions.map((item) => (
                  <Button
                    key={item.label}
                    variant={item.variant}
                    size="sm"
                    fullWidth
                    onClick={() => {
                      if (item.href) {
                        router.push(item.href);
                        return;
                      }

                      void item.action?.();
                    }}
                    leftIcon={<span className="material-symbols-outlined text-sm">{item.icon}</span>}
                    className="justify-start"
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
