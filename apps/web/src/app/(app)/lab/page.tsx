'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { sessionsApi } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { formatRelativeTime } from '@/lib/utils';

export default function LabIndexPage() {
  const { data: sessions, isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: sessionsApi.list,
    staleTime: 30_000,
  });

  const activeSessions = (sessions ?? []).filter(
    (s) => s.status === 'active' || s.status === 'provisioning' || s.status === 'paused',
  );

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-lg space-y-6">
        {/* Header */}
        <div className="text-center">
          <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary to-[#4453a7] flex items-center justify-center mx-auto mb-4">
            <span className="material-symbols-outlined text-3xl text-[#00105b]">terminal</span>
          </div>
          <h1 className="font-headline text-2xl font-bold text-on-surface">SQL Lab</h1>
          <p className="text-sm text-on-surface-variant mt-2">
            Select a lesson from a track to spin up your sandbox workspace.
          </p>
        </div>

        {/* Active sessions */}
        {isLoading ? (
          <div className="bg-surface-container-low rounded-xl p-5 space-y-3">
            <div className="h-4 w-32 bg-surface-container rounded animate-pulse" />
            {[1, 2].map((i) => (
              <div key={i} className="h-14 bg-surface-container rounded-xl animate-pulse" />
            ))}
          </div>
        ) : activeSessions.length > 0 ? (
          <div className="bg-surface-container-low rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-on-surface">Resume a Session</h2>
            <div className="space-y-2">
              {activeSessions.map((s) => (
                <Link key={s.id} href={`/lab/${s.id}`}>
                  <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-container hover:bg-surface-container-high transition-colors cursor-pointer">
                    <span className="material-symbols-outlined text-xl text-primary shrink-0">
                      terminal
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-on-surface truncate">
                        {s.lessonTitle ?? 'Lab Session'}
                      </p>
                      <p className="text-xs text-on-surface-variant">
                        {s.lastActivityAt
                          ? formatRelativeTime(s.lastActivityAt)
                          : formatRelativeTime(s.startedAt)}
                      </p>
                    </div>
                    <StatusBadge status={s.status} />
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {/* CTA */}
        <div className="bg-surface-container-low rounded-xl p-5 space-y-4">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-2xl text-secondary mt-0.5 shrink-0">
              school
            </span>
            <div>
              <h2 className="text-sm font-semibold text-on-surface">Start from a Track</h2>
              <p className="text-xs text-on-surface-variant mt-1 leading-relaxed">
                Each lesson provides its own sandboxed PostgreSQL environment with a pre-loaded
                dataset. Browse the available tracks to pick a lesson and launch your workspace.
              </p>
            </div>
          </div>
          <Link href="/tracks">
            <Button
              variant="primary"
              fullWidth
              size="lg"
              leftIcon={<span className="material-symbols-outlined">menu_book</span>}
            >
              Browse Tracks &amp; Lessons
            </Button>
          </Link>
        </div>

        <p className="text-center text-xs text-outline">
          Sandbox sessions auto-expire after 2 hours of inactivity
        </p>
      </div>
    </div>
  );
}
