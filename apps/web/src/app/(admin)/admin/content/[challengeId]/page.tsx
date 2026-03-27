'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DifficultyBadge, StatusBadge } from '@/components/ui/badge';
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
import { ChallengePassMetricsPanel } from '@/components/challenge/challenge-pass-metrics';
import { getChallengePassCriteriaLines } from '@/lib/challenge-pass-criteria';
import { challengesApi } from '@/lib/api';
import { cn, formatDate, generateInitials } from '@/lib/utils';

export default function AdminChallengeDetailPage() {
  const params = useParams();
  const challengeId = typeof params.challengeId === 'string' ? params.challengeId : '';
  const [rankingOpen, setRankingOpen] = useState(false);

  const draftQuery = useQuery({
    queryKey: ['admin-challenge-draft', challengeId],
    enabled: Boolean(challengeId),
    queryFn: () => challengesApi.getDraft(challengeId),
  });

  const publishedVersionId = draftQuery.data?.publishedVersionId ?? null;

  const leaderboardQuery = useQuery({
    queryKey: ['admin-challenge-detail-leaderboard', publishedVersionId],
    enabled: rankingOpen && Boolean(publishedVersionId),
    queryFn: () => challengesApi.getLeaderboard(publishedVersionId!, 50),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!rankingOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setRankingOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [rankingOpen]);

  if (!challengeId) {
    return (
      <div className="page-shell-wide page-stack pb-10">
        <p className="text-sm text-on-surface-variant">Invalid challenge.</p>
      </div>
    );
  }

  if (draftQuery.isLoading) {
    return (
      <div className="page-shell-wide page-stack pb-10">
        <div className="h-8 w-48 animate-pulse rounded bg-surface-container-low" />
        <div className="mt-6 h-64 animate-pulse rounded-xl bg-surface-container-low" />
      </div>
    );
  }

  if (draftQuery.isError || !draftQuery.data) {
    return (
      <div className="page-shell-wide page-stack pb-10">
        <Link href="/admin/content" className="text-sm text-primary hover:underline">
          ← Back to challenges
        </Link>
        <p className="mt-4 text-sm text-error">Could not load this challenge (or you lack access).</p>
      </div>
    );
  }

  const d = draftQuery.data;
  const v = d.latestVersion;
  const leaders = leaderboardQuery.data ?? [];

  return (
    <div className="page-shell-wide page-stack pb-10">
      <Link href="/admin/content" className="text-sm text-primary hover:underline">
        ← Back to challenges
      </Link>

      <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="page-title">{d.title}</h1>
          <p className="mt-2 font-mono text-xs text-on-surface-variant">{d.slug}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusBadge status={d.status} className="capitalize" />
            <DifficultyBadge difficulty={d.difficulty} className="capitalize" />
            <span className="text-xs text-on-surface-variant">
              v{v.versionNo} · {formatDate(v.createdAt)}
            </span>
          </div>
        </div>
        {d.status === 'published' && d.publishedVersionId ? (
          <button
            type="button"
            onClick={() => setRankingOpen(true)}
            className={cn(
              'inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-outline-variant bg-surface-container-high px-4 text-sm font-medium text-on-surface transition-all duration-150',
              'hover:bg-surface-container-highest active:bg-surface-bright',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-outline focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
            )}
          >
            View ranking
          </button>
        ) : null}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-5 lg:col-span-1">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-outline">Catalog</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div>
              <dt className="text-on-surface-variant">Database</dt>
              <dd className="mt-0.5 font-medium text-on-surface">{d.databaseName ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant">Points</dt>
              <dd className="mt-0.5 font-mono font-semibold text-on-surface">{d.points}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant">Sort order</dt>
              <dd className="mt-0.5 font-mono text-on-surface">{d.sortOrder}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant">Updated</dt>
              <dd className="mt-0.5 text-on-surface">{formatDate(d.updatedAt)}</dd>
            </div>
            <div>
              <dt className="text-on-surface-variant">Review</dt>
              <dd className="mt-0.5 capitalize text-on-surface">{v.reviewStatus.replace(/_/g, ' ')}</dd>
            </div>
          </dl>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-outline">Description</h2>
            <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
              {d.description?.trim() ? d.description : '—'}
            </p>
          </section>

          <section className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-outline">
              Problem statement
            </h2>
            <pre className="mt-3 whitespace-pre-wrap font-body text-sm leading-relaxed text-on-surface">
              {v.problemStatement}
            </pre>
          </section>

          <section className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-outline">
              Tiêu chí đạt (pass)
            </h2>
            <p className="mt-2 text-xs text-on-surface-variant">
              Khớp với logic chấm trên server (evaluateAttempt); không hiển thị reference SQL cho learner.
            </p>
            <ChallengePassMetricsPanel validatorConfig={v.validatorConfig} className="mt-4" />
            <ul className="mt-4 list-disc space-y-2 pl-4 text-sm leading-relaxed text-on-surface-variant">
              {getChallengePassCriteriaLines({
                validatorType: v.validatorType,
                validatorConfig: v.validatorConfig,
                points: d.points,
              }).map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
            {v.expectedResultColumns?.length ? (
              <div className="mt-4 border-t border-outline-variant/10 pt-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-outline">
                  Expected columns
                </p>
                <div className="flex flex-wrap gap-2">
                  {v.expectedResultColumns.map((column) => (
                    <code
                      key={column}
                      className="rounded-md bg-surface-container-highest px-2 py-1 font-mono text-xs text-on-surface"
                    >
                      {column}
                    </code>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {v.hintText ? (
            <section className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-5">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-outline">Hint</h2>
              <p className="mt-3 text-sm text-on-surface-variant">{v.hintText}</p>
            </section>
          ) : null}

          <section className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-outline">
              Reference solution
            </h2>
            <pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-container-highest p-3 font-mono text-xs text-on-surface">
              {v.referenceSolution ?? '—'}
            </pre>
            <p className="mt-2 text-xs text-on-surface-variant">Validator type: {v.validatorType}</p>
          </section>
        </div>
      </div>

      {rankingOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8 backdrop-blur-sm"
          role="presentation"
          onClick={() => setRankingOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="challenge-ranking-title"
            className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-low shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-4 border-b border-outline-variant/10 px-5 py-4">
              <div className="min-w-0">
                <h2 id="challenge-ranking-title" className="text-lg font-semibold text-on-surface">
                  Challenge ranking
                </h2>
                <p className="mt-1 truncate text-sm text-on-surface-variant">{d.title}</p>
                <p className="mt-0.5 text-xs text-outline">Top 50 by published version</p>
              </div>
              <button
                type="button"
                onClick={() => setRankingOpen(false)}
                className="shrink-0 rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                aria-label="Close"
              >
                <span className="material-symbols-outlined text-xl" aria-hidden>
                  close
                </span>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-2 pb-4 pt-2 sm:px-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rank</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Best run</TableHead>
                    <TableHead>Attempts</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {leaderboardQuery.isLoading ? (
                    <TableSkeleton rows={8} cols={5} />
                  ) : leaderboardQuery.isError ? (
                    <TableEmpty
                      message="Could not load leaderboard for this challenge."
                      colSpan={5}
                    />
                  ) : leaders.length === 0 ? (
                    <TableEmpty message="No ranking entries yet." colSpan={5} />
                  ) : (
                    leaders.map((entry) => (
                      <TableRow key={entry.attemptId}>
                        <TableCell className="font-mono text-xs text-on-surface-variant">
                          #{entry.rank}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-xs font-semibold text-on-surface">
                              {generateInitials(entry.displayName)}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium text-on-surface">
                                {entry.displayName}
                              </p>
                              <p className="truncate text-xs text-on-surface-variant">
                                @{entry.username}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-sm text-secondary">
                          <div>
                            {entry.bestDurationMs != null ? `${entry.bestDurationMs} ms` : '—'}
                          </div>
                          <div className="text-xs text-on-surface-variant">
                            cost{' '}
                            {entry.bestTotalCost != null ? Math.round(entry.bestTotalCost) : '—'}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-on-surface-variant">
                          {entry.attemptsCount}
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={entry.passedAttempts > 0 ? 'completed' : 'pending'}
                          />
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
