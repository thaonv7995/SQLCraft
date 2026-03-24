'use client';

import Link from 'next/link';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAuthStore } from '@/stores/auth';
import { cn, formatRelativeTime } from '@/lib/utils';

const KPI_CARDS = [
  {
    label: 'Merged This Quarter',
    value: '18',
    delta: '+4 vs last sprint',
    icon: 'merge',
    accent: 'border-secondary',
    tone: 'text-secondary',
  },
  {
    label: 'Active Drafts',
    value: '06',
    delta: '2 awaiting review',
    icon: 'edit_note',
    accent: 'border-primary',
    tone: 'text-primary',
  },
  {
    label: 'Average Review SLA',
    value: '31h',
    delta: 'steady in the green',
    icon: 'timer',
    accent: 'border-tertiary',
    tone: 'text-tertiary',
  },
  {
    label: 'Issue Coverage',
    value: '92%',
    delta: 'high priority queue stable',
    icon: 'query_stats',
    accent: 'border-error',
    tone: 'text-error',
  },
];

const ACTIVE_DRAFTS = [
  {
    id: 'draft-1',
    title: 'Retention Cohorts for Subscription Rescue',
    domain: 'Analytics',
    updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    status: 'draft',
  },
  {
    id: 'draft-2',
    title: 'Chargeback Investigation Drill',
    domain: 'Fintech',
    updatedAt: new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(),
    status: 'pending',
  },
  {
    id: 'draft-3',
    title: 'Healthcare Claims Reconciliation Lab',
    domain: 'Health Systems',
    updatedAt: new Date(Date.now() - 28 * 60 * 60 * 1000).toISOString(),
    status: 'active',
  },
  {
    id: 'draft-4',
    title: 'Warehouse Order Velocity Benchmark',
    domain: 'E-Commerce',
    updatedAt: new Date(Date.now() - 52 * 60 * 60 * 1000).toISOString(),
    status: 'draft',
  },
];

const HIGH_PRIORITY_REQUESTS = [
  {
    title: 'Recursive CTE mission pack',
    detail: 'Leaderboard demand is climbing after three consecutive advanced track completions.',
    signal: 'High urgency',
  },
  {
    title: 'Fraud analytics sandbox refresh',
    detail: 'Contributors are asking for fresher fintech data with clearer anomaly labels.',
    signal: 'New brief',
  },
  {
    title: 'Postgres 16 query plan snapshots',
    detail: 'Need updated execution plan screenshots for the optimizer lessons.',
    signal: 'Review needed',
  },
];

const TRENDING_DOMAINS = [
  { name: 'Fintech', growth: '+18%', note: 'Fraud ops and ledger balancing missions lead the queue.' },
  { name: 'Analytics', growth: '+12%', note: 'Demand is centered on cohorting, rollups, and materialized views.' },
  { name: 'Health Systems', growth: '+9%', note: 'Interest is shifting toward claims joins and encounter timelines.' },
];

function MetricCard({
  label,
  value,
  delta,
  icon,
  accent,
  tone,
}: (typeof KPI_CARDS)[number]) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-outline-variant/10 border-l-4 bg-surface-container-low p-5 shadow-[0_10px_30px_rgba(0,0,0,0.12)]',
        accent,
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-outline">{label}</p>
          <p className={cn('mt-3 font-headline text-3xl font-bold', tone)}>{value}</p>
          <p className="mt-2 text-sm text-on-surface-variant">{delta}</p>
        </div>
        <div
          className={cn(
            'flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-container-high',
            tone,
          )}
        >
          <span className="material-symbols-outlined text-2xl">{icon}</span>
        </div>
      </div>
    </div>
  );
}

export default function ContributorPage() {
  const { user } = useAuthStore();
  const displayName = user?.displayName ?? user?.username ?? 'Contributor';

  return (
    <>
      <div className="page-shell page-stack">
        <section className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-8 py-8">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="border-l-2 border-primary pl-5">
              <p className="text-xs uppercase tracking-[0.24em] text-outline">
                Contributor command board
              </p>
              <h1 className="mt-3 font-headline text-4xl font-bold tracking-tight text-on-surface">
                {displayName}
              </h1>
              <p className="mt-3 max-w-3xl text-base leading-7 text-on-surface-variant">
                Review pipeline pressure, keep high-priority drafts moving, and respond to what the
                catalog needs next before demand overtakes supply.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Badge className="bg-surface-container-high text-on-surface-variant">
                Review lane healthy
              </Badge>
              <Badge className="bg-secondary/10 text-secondary">6 drafts in motion</Badge>
              <Link href="/admin/content">
                <Button
                  leftIcon={<span className="material-symbols-outlined text-sm">add</span>}
                >
                  New Mission
                </Button>
              </Link>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {KPI_CARDS.map((metric) => (
            <MetricCard key={metric.label} {...metric} />
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-12">
          <div className="space-y-6 xl:col-span-8">
            <Card className="rounded-[28px] border border-outline-variant/10">
              <CardHeader className="px-6 py-5">
                <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                  <div>
                    <CardTitle className="text-xl">Active Drafts</CardTitle>
                    <CardDescription className="mt-1 max-w-2xl">
                      Content in motion right now. Keep these artifacts flowing through review,
                      validation, and launch.
                    </CardDescription>
                  </div>
                  <Link href="/admin/content">
                    <Button variant="secondary" size="sm">
                      Open content queue
                    </Button>
                  </Link>
                </div>
              </CardHeader>
              <CardContent className="px-0 pb-2 pt-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Title</TableHead>
                      <TableHead>Domain</TableHead>
                      <TableHead>Last Updated</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ACTIVE_DRAFTS.length === 0 ? (
                      <TableEmpty colSpan={4} message="No active drafts right now." />
                    ) : (
                      ACTIVE_DRAFTS.map((draft) => (
                        <TableRow key={draft.id}>
                          <TableCell>
                            <div className="space-y-1">
                              <p className="font-medium text-on-surface">{draft.title}</p>
                              <p className="text-xs uppercase tracking-[0.18em] text-outline">
                                Draft {draft.id}
                              </p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <Badge className="bg-surface-container-high text-on-surface-variant">
                              {draft.domain}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-on-surface-variant">
                            {formatRelativeTime(draft.updatedAt)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={draft.status} />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6 xl:col-span-4">
            <Card className="rounded-[28px] border border-outline-variant/10">
              <CardHeader className="px-6 py-5">
                <div>
                  <CardTitle className="text-xl">Market Intelligence</CardTitle>
                  <CardDescription className="mt-1">
                    Signals that should shape the next contributor sprint.
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent className="space-y-4 px-6 pb-6 pt-0">
                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-outline">
                    High Priority Requests
                  </p>
                  {HIGH_PRIORITY_REQUESTS.map((request) => (
                    <div
                      key={request.title}
                      className="rounded-2xl border border-outline-variant/10 bg-surface-container-low p-4"
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="font-medium text-on-surface">{request.title}</p>
                        <Badge className="bg-error/10 text-error">{request.signal}</Badge>
                      </div>
                      <p className="text-sm leading-6 text-on-surface-variant">
                        {request.detail}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="space-y-3">
                  <p className="text-xs uppercase tracking-[0.18em] text-outline">
                    Trending Domains
                  </p>
                  {TRENDING_DOMAINS.map((domain) => (
                    <div
                      key={domain.name}
                      className="rounded-2xl border border-outline-variant/10 bg-surface-container-low p-4"
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <p className="font-medium text-on-surface">{domain.name}</p>
                        <span className="font-mono text-sm text-secondary">{domain.growth}</span>
                      </div>
                      <p className="text-sm leading-6 text-on-surface-variant">{domain.note}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>

      <Link href="/admin/content" className="fixed bottom-8 right-8 z-30">
        <Button
          size="lg"
          className="shadow-[0_18px_40px_rgba(68,83,167,0.35)]"
          leftIcon={<span className="material-symbols-outlined">add_circle</span>}
        >
          New Mission
        </Button>
      </Link>
    </>
  );
}
