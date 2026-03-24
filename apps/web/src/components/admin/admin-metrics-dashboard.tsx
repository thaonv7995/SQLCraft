'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { adminApi } from '@/lib/api';
import { StatCard } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { Button, type ButtonVariant } from '@/components/ui/button';
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
    href: '/admin/users',
    label: 'User Management',
    description: 'Review privileges, access status, and contributor activity.',
    icon: 'group',
  },
  {
    href: '/admin/content',
    label: 'Content Moderation',
    description: 'Publish, archive, and inspect track and lesson operations.',
    icon: 'verified_user',
  },
  {
    href: '/admin/health/logs',
    label: 'System Logs',
    description: 'Inspect privileged actions, job failures, and audit history.',
    icon: 'receipt_long',
  },
];

export function AdminMetricsDashboard({ variant }: AdminMetricsDashboardProps) {
  const router = useRouter();

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

  const displayJobs = jobs ?? [];

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
      ? 'Central control plane for platform metrics, operator workflows, and privileged activity.'
      : 'Real-time platform metrics and infrastructure status.';
  const statusLabel =
    variant === 'overview' ? 'Control plane live' : 'All systems operational';

  const quickActions: QuickAction[] =
    variant === 'overview'
      ? [
          {
            label: 'Open System Health',
            icon: 'dns',
            href: '/admin/health',
            variant: 'secondary',
          },
          {
            label: 'Review Users',
            icon: 'group',
            href: '/admin/users',
            variant: 'ghost',
          },
          {
            label: 'Inspect Logs',
            icon: 'receipt_long',
            href: '/admin/health/logs',
            variant: 'ghost',
          },
          {
            label: 'Terminate All Sandboxes',
            icon: 'stop_circle',
            action: handleTerminateAll,
            variant: 'destructive',
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
            label: 'Run Migrations',
            icon: 'upgrade',
            action: () => {
              toast.success('Migrations queued');
            },
            variant: 'secondary',
          },
          {
            label: 'Sync Content',
            icon: 'sync',
            action: () => {
              toast.success('Sync started');
            },
            variant: 'secondary',
          },
          {
            label: 'Export User Data',
            icon: 'download',
            action: () => {
              toast.success('Export queued');
            },
            variant: 'ghost',
          },
          {
            label: 'View System Logs',
            icon: 'receipt_long',
            href: '/admin/health/logs',
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {NAVIGATION_CARDS.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="group rounded-xl border border-outline-variant/10 bg-surface-container-low p-5 transition-colors hover:border-outline-variant/30 hover:bg-surface-container"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-on-surface group-hover:text-on-surface transition-colors">
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

      {metricsLoading || !metrics ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-surface-container-low rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="Active Sandboxes"
            value={metrics.activeSandboxes}
            accent="tertiary"
            icon={<span className="material-symbols-outlined">dns</span>}
          />
          <StatCard
            label="Query Success Rate"
            value={`${metrics.querySuccessRate}%`}
            delta="+0.3% vs yesterday"
            deltaPositive
            accent="secondary"
            icon={<span className="material-symbols-outlined">verified</span>}
          />
          <StatCard
            label="p95 Latency"
            value={`${metrics.p95LatencyMs}ms`}
            accent="primary"
            icon={<span className="material-symbols-outlined">speed</span>}
          />
          <StatCard
            label="Queries (24h)"
            value={metrics.totalQueriesLast24h.toLocaleString()}
            delta="+12% vs last week"
            deltaPositive
            accent="primary"
            icon={<span className="material-symbols-outlined">query_stats</span>}
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface-container-low rounded-xl p-5 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-outline">Total Users</h3>
          <p className="text-3xl font-headline font-bold text-on-surface">
            {metricsLoading || !metrics ? '—' : metrics.totalUsers.toLocaleString()}
          </p>
          <p className="text-xs text-secondary">+34 today</p>
        </div>
        <div className="bg-surface-container-low rounded-xl p-5 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-outline">Error Rate</h3>
          <p
            className={`text-3xl font-headline font-bold ${
              metrics && metrics.errorRate > 5 ? 'text-error' : 'text-on-surface'
            }`}
          >
            {metricsLoading || !metrics ? '—' : `${metrics.errorRate}%`}
          </p>
          <p className="text-xs text-on-surface-variant">Query execution errors</p>
        </div>
        <div className="bg-surface-container-low rounded-xl p-5 space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-outline">Sandbox Pool</h3>
          <div className="flex items-end gap-2">
            <p className="text-3xl font-headline font-bold text-on-surface">
              {metricsLoading || !metrics ? '—' : metrics.activeSandboxes}
            </p>
            <p className="text-sm text-on-surface-variant mb-1">/ 50 max</p>
          </div>
          <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
            <div
              className="h-full bg-on-surface-variant rounded-full"
              style={{ width: metrics ? `${(metrics.activeSandboxes / 50) * 100}%` : '0%' }}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
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
                  const duration = job.completedAt
                    ? `${Math.round(
                        (new Date(job.completedAt).getTime() -
                          new Date(job.startedAt).getTime()) /
                          1000
                      )}s`
                    : job.status === 'running'
                      ? 'Running...'
                      : '-';

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

        <div className="bg-surface-container-low rounded-xl p-5 space-y-4">
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
  );
}
