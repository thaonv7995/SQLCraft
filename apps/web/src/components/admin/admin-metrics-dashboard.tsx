'use client';

import Link from 'next/link';
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
  TableSkeleton,
} from '@/components/ui/table';
import { formatRelativeTime } from '@/lib/utils';
import toast from 'react-hot-toast';

interface AdminMetricsDashboardProps {
  variant: 'overview' | 'health';
}

interface NavigationCard {
  href: string;
  label: string;
  description: string;
  icon: string;
}

interface QuickAction {
  label: string;
  icon: string;
  variant: ButtonVariant;
  href?: string;
  action?: () => void | Promise<void>;
}

const NAVIGATION_CARDS: NavigationCard[] = [
  {
    href: '/admin/content',
    label: 'Content',
    description: 'Manage lessons, challenges, and the review queue for user submissions.',
    icon: 'verified_user',
  },
  {
    href: '/admin/databases',
    label: 'Databases',
    description: 'Operate schema templates, SQL imports, datasets, and generation jobs.',
    icon: 'database',
  },
  {
    href: '/admin/rankings',
    label: 'Rankings',
    description: 'Inspect global standings, challenge leaderboards, and point surfaces.',
    icon: 'leaderboard',
  },
  {
    href: '/admin/users',
    label: 'Users',
    description: 'Moderate accounts, review practice stats, and manage admin access.',
    icon: 'group',
  },
  {
    href: '/admin/system',
    label: 'System',
    description: 'Track queue health, runtime status, and operational pressure.',
    icon: 'dns',
  },
];

export function AdminMetricsDashboard({ variant }: AdminMetricsDashboardProps) {
  const router = useRouter();

  const { data: health, isLoading: healthLoading } = useQuery({
    queryKey: ['admin-system-health-dashboard'],
    queryFn: adminApi.systemHealth,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const { data: jobs, isLoading: jobsLoading } = useQuery({
    queryKey: ['admin-jobs-dashboard'],
    queryFn: () => adminApi.systemJobs({ limit: 8 }),
    staleTime: 15_000,
  });

  const { data: topLeaders, isLoading: leadersLoading, isError: leadersError } = useQuery({
    queryKey: ['admin-overview-leaders'],
    queryFn: () => adminApi.globalLeaderboard('alltime', 5),
    staleTime: 30_000,
    enabled: variant === 'overview',
  });

  const displayJobs = jobs ?? [];
  const pendingJobs =
    health?.stats.pendingJobs ?? displayJobs.filter((job) => job.status === 'pending').length;
  const runningJobs = displayJobs.filter((job) => job.status === 'running').length;
  const failedJobs = displayJobs.filter((job) => job.status === 'failed').length;

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
      ? 'Operational snapshot for SQL practice content, user standings, and worker activity.'
      : 'Real-time infrastructure status for sessions, queue pressure, and content inventory.';
  const statusLabel =
    variant === 'overview' ? 'Admin console ready' : 'System telemetry live';

  const quickActions: QuickAction[] =
    variant === 'overview'
      ? [
          {
            label: 'Review Queue',
            icon: 'rule_settings',
            href: '/admin/content?tab=review',
            variant: 'secondary',
          },
          {
            label: 'Open Rankings',
            icon: 'leaderboard',
            href: '/admin/rankings',
            variant: 'ghost',
          },
          {
            label: 'Manage Databases',
            icon: 'database',
            href: '/admin/databases',
            variant: 'ghost',
          },
          {
            label: 'Inspect System',
            icon: 'dns',
            href: '/admin/system',
            variant: 'ghost',
          },
        ]
      : [
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
            href: '/admin/databases?tab=sql-imports',
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

      {variant === 'overview' && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          {NAVIGATION_CARDS.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="group rounded-xl border border-outline-variant/10 bg-surface-container-low p-5 transition-colors hover:border-outline-variant/30 hover:bg-surface-container"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-on-surface transition-colors group-hover:text-on-surface">
                    {card.label}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-on-surface-variant">
                    {card.description}
                  </p>
                </div>
                <span className="material-symbols-outlined text-on-surface-variant group-hover:text-on-surface">
                  {card.icon}
                </span>
              </div>
            </Link>
          ))}
        </div>
      )}

      {healthLoading || !health ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {[1, 2, 3, 4].map((index) => (
            <div key={index} className="h-24 animate-pulse rounded-xl bg-surface-container-low" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label="Total Users"
            value={health.stats.users.toLocaleString()}
            accent="primary"
            icon={<span className="material-symbols-outlined">group</span>}
          />
          <StatCard
            label="Active Sessions"
            value={health.stats.activeSessions}
            accent="tertiary"
            icon={<span className="material-symbols-outlined">dns</span>}
          />
          <StatCard
            label="Published Lessons"
            value={health.stats.lessons}
            accent="secondary"
            icon={<span className="material-symbols-outlined">menu_book</span>}
          />
          <StatCard
            label="Pending Jobs"
            value={pendingJobs}
            accent="primary"
            icon={<span className="material-symbols-outlined">account_tree</span>}
          />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="rounded-xl bg-surface-container-low p-5 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-outline">Tracks</h3>
          <p className="text-3xl font-headline font-bold text-on-surface">
            {healthLoading || !health ? '—' : health.stats.tracks.toLocaleString()}
          </p>
          <p className="text-xs text-on-surface-variant">Current practice catalog groups</p>
        </div>
        <div className="rounded-xl bg-surface-container-low p-5 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-outline">Running Jobs</h3>
          <p className="text-3xl font-headline font-bold text-on-surface">{runningJobs}</p>
          <p className="text-xs text-on-surface-variant">Workers currently executing</p>
        </div>
        <div className="rounded-xl bg-surface-container-low p-5 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-outline">Failed Jobs</h3>
          <div className="flex items-end gap-2">
            <p className={`text-3xl font-headline font-bold ${failedJobs > 0 ? 'text-error' : 'text-on-surface'}`}>
              {failedJobs}
            </p>
            <p className="mb-1 text-sm text-on-surface-variant">recent</p>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-container-highest">
            <div
              className={failedJobs > 0 ? 'h-full rounded-full bg-error' : 'h-full rounded-full bg-secondary'}
              style={{ width: `${Math.min((Math.max(failedJobs, 1) / 8) * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.9fr_1fr]">
        <div className="overflow-hidden rounded-xl bg-surface-container-low">
          <div className="flex items-center justify-between px-5 py-4">
            <h2 className="font-headline text-base font-semibold text-on-surface">
              Recent Worker Jobs
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
                  <CardTitle>Leaderboard Snapshot</CardTitle>
                  <CardDescription className="mt-1">
                    Top global performers across solved SQL practice content.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 px-5 pb-5 pt-0">
                {leadersLoading ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((index) => (
                      <div key={index} className="h-12 animate-pulse rounded-xl bg-surface-container" />
                    ))}
                  </div>
                ) : leadersError ? (
                  <p className="text-sm text-on-surface-variant">
                    Global ranking data is not available in this environment yet.
                  </p>
                ) : (topLeaders ?? []).length === 0 ? (
                  <p className="text-sm text-on-surface-variant">No ranking entries yet.</p>
                ) : (
                  (topLeaders ?? []).map((entry) => (
                    <div
                      key={entry.userId}
                      className="flex items-center justify-between rounded-xl bg-surface-container px-3 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-on-surface">
                          #{entry.rank} {entry.displayName}
                        </p>
                        <p className="truncate text-xs text-on-surface-variant">
                          @{entry.username}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm text-secondary">
                          {entry.points.toLocaleString()} pts
                        </p>
                        <p className="text-xs text-on-surface-variant">
                          {entry.challengesCompleted} solved
                        </p>
                      </div>
                    </div>
                  ))
                )}

                <Link href="/admin/rankings" className="inline-flex">
                  <Button variant="secondary" size="sm">
                    Open Rankings
                  </Button>
                </Link>
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
        </div>
      </div>
    </div>
  );
}
