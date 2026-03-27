'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { sessionsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useAppPageProps } from '@/lib/next-app-page';

export default function LabIndexPage(props: PageProps<'/lab'>) {
  useAppPageProps(props);
  const { data: sessions, isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: sessionsApi.list,
    staleTime: 30_000,
  });

  const activeSessions = (sessions ?? []).filter(
    (s) => s.status === 'active' || s.status === 'provisioning' || s.status === 'paused',
  );

  return (
    <div className="page-shell">
      <div className="page-stack mx-auto w-full max-w-4xl">
        {/* Hero — aligned with dashboard / explore */}
        <section
        className="overflow-hidden rounded-2xl border border-outline-variant/10 bg-surface-container-low"
          aria-labelledby="lab-title"
        >
          <div className="flex flex-col gap-6 p-5 sm:p-6 lg:flex-row lg:items-center lg:justify-between lg:gap-10 lg:p-8">
            <div className="flex min-w-0 flex-1 items-start gap-4">
              <div
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-outline-variant/10 bg-surface-container-high"
                aria-hidden
              >
                <span
                  className="material-symbols-outlined text-2xl text-tertiary"
                  style={{ fontVariationSettings: "'FILL' 1" }}
                >
                  terminal
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wider text-outline">
                  Workspace
                </p>
                <h1
                  id="lab-title"
                  className="font-headline mt-1 text-2xl font-bold tracking-tight text-on-surface sm:text-3xl"
                >
                  SQL Lab
                </h1>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-on-surface-variant">
                  Isolated Postgres sandboxes for practice. Pick a database from the catalog to start
                  fresh, or resume an open session below.
                </p>
              </div>
            </div>
            <div className="w-full shrink-0 lg:w-auto lg:min-w-[200px]">
              <Link href="/explore" className="block">
                <Button
                  variant="primary"
                  size="lg"
                  fullWidth
                  className="lg:min-w-[200px]"
                  leftIcon={<span className="material-symbols-outlined text-xl">travel_explore</span>}
                >
                  Browse databases
                </Button>
              </Link>
            </div>
          </div>
        </section>

        {/* Sessions */}
        {isLoading ? (
          <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low p-5 sm:p-6">
            <div className="mb-4 h-4 w-44 animate-pulse rounded bg-surface-container" />
            <div className="space-y-2">
              {[1, 2].map((i) => (
                <div key={i} className="h-[52px] animate-pulse rounded-xl bg-surface-container" />
              ))}
            </div>
          </div>
        ) : activeSessions.length > 0 ? (
          <Card className="rounded-2xl border border-outline-variant/10 bg-surface-container-low">
            <CardHeader className="flex flex-col items-stretch gap-1 border-b border-outline-variant/10 px-5 py-4 sm:px-6 sm:py-5">
              <CardTitle className="text-lg">Resume a session</CardTitle>
              <CardDescription>Open a sandbox you already have running.</CardDescription>
            </CardHeader>
            <CardContent className="px-3 pb-4 pt-2 sm:px-4 sm:pb-5">
              <ul className="space-y-1.5">
                {activeSessions.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={`/lab/${s.id}`}
                      className={cn(
                        'group flex items-center gap-3 rounded-xl border border-outline-variant/10 bg-surface-container/60 px-3 py-2.5 transition-colors',
                        'hover:border-outline-variant/25 hover:bg-surface-container-high sm:px-4 sm:py-3',
                      )}
                    >
                      <span
                        className="material-symbols-outlined shrink-0 text-lg text-on-surface-variant group-hover:text-on-surface"
                        aria-hidden
                      >
                        terminal
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-on-surface">
                          {s.displayTitle ?? s.lessonTitle ?? 'Lab session'}
                        </p>
                        <p className="text-[11px] text-on-surface-variant">
                          {s.lastActivityAt
                            ? formatRelativeTime(s.lastActivityAt)
                            : formatRelativeTime(s.startedAt)}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <StatusBadge status={s.status} />
                        <span
                          className="material-symbols-outlined text-lg text-outline transition-colors group-hover:text-on-surface-variant"
                          aria-hidden
                        >
                          chevron_right
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}

        <p className="text-xs text-on-surface-variant">
          Sandbox sessions auto-expire after 2 hours of inactivity.
        </p>
      </div>
    </div>
  );
}
