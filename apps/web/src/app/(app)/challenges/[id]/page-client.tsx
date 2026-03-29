'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { DifficultyBadge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { challengesApi, sessionsApi, type ChallengeCatalogItem } from '@/lib/api';
import { ChallengePassCriteriaDisplay } from '@/components/challenge/challenge-pass-criteria-display';
import { saveLabBootstrap } from '@/lib/lab-bootstrap';
import { useAuthStore } from '@/stores/auth';
import { formatRelativeTime } from '@/lib/utils';
import type { ClientPageProps } from '@/lib/page-props';

const DATASET_SCALE_META: Record<
  ChallengeCatalogItem['datasetScale'],
  { label: string; desc: string }
> = {
  tiny: { label: 'Tiny', desc: '100 rows' },
  small: { label: 'Small', desc: '10K rows' },
  medium: { label: 'Medium', desc: '1M-5M rows' },
  large: { label: 'Large', desc: '10M+ rows' },
};

export default function ChallengeDetailPage({ params }: ClientPageProps) {
  const router = useRouter();
  const { user } = useAuthStore();
  const challengeId = params.id ?? '';
  const [isStartingSubmission, setIsStartingSubmission] = useState(false);

  const catalogQuery = useQuery({
    queryKey: ['published-challenges'],
    queryFn: () => challengesApi.listPublished(),
    staleTime: 60_000,
  });

  const mineQuery = useQuery({
    queryKey: ['my-challenges'],
    queryFn: () => challengesApi.listMine(),
    staleTime: 60_000,
  });

  const challenge = useMemo<ChallengeCatalogItem | null>(() => {
    const fromPub = catalogQuery.data?.find(
      (item) => item.id === challengeId || item.slug === challengeId,
    );
    if (fromPub) return fromPub;
    return (
      mineQuery.data?.find((item) => item.id === challengeId || item.slug === challengeId) ?? null
    );
  }, [catalogQuery.data, mineQuery.data, challengeId]);

  const isYours = useMemo(
    () => mineQuery.data?.some((c) => c.id === challenge?.id) ?? false,
    [mineQuery.data, challenge?.id],
  );

  const draftQuery = useQuery({
    queryKey: ['user-challenge-draft', challenge?.id],
    enabled: Boolean(isYours && challenge?.id),
    queryFn: () => challengesApi.getDraft(challenge!.id),
    staleTime: 30_000,
  });

  const hasPublishedPlay = Boolean(challenge?.publishedVersionId);

  const versionQuery = useQuery({
    queryKey: ['challenge-version-detail', challenge?.publishedVersionId],
    enabled: hasPublishedPlay,
    queryFn: () => challengesApi.getVersion(challenge!.publishedVersionId!),
    staleTime: 30_000,
  });

  const problemStatement =
    versionQuery.data?.problemStatement ?? draftQuery.data?.latestVersion.problemStatement ?? '';
  const hintText = versionQuery.data?.hintText ?? draftQuery.data?.latestVersion.hintText ?? null;
  const validatorConfigForDisplay =
    versionQuery.data?.validatorConfig ?? draftQuery.data?.latestVersion.validatorConfig ?? null;

  const attemptsQuery = useQuery({
    queryKey: ['challenge-attempts', challenge?.publishedVersionId],
    enabled: Boolean(user?.id && challenge?.publishedVersionId),
    queryFn: () => challengesApi.listAttempts(challenge!.publishedVersionId!),
    staleTime: 15_000,
  });

  const leaderboardQuery = useQuery({
    queryKey: ['challenge-leaderboard', challenge?.publishedVersionId],
    enabled: Boolean(challenge?.publishedVersionId),
    queryFn: () => challengesApi.getLeaderboard(challenge!.publishedVersionId!, 10),
    staleTime: 30_000,
  });

  const startSubmission = async () => {
    if (!challenge?.publishedVersionId) {
      toast.error('Challenge is not ready to create a submission.');
      return;
    }

    setIsStartingSubmission(true);
    try {
      const session = await sessionsApi.create({
        challengeVersionId: challenge.publishedVersionId,
      });

      saveLabBootstrap(session.id, {
        mode: 'challenge',
        lessonTitle: challenge.databaseName ?? undefined,
        databaseName: challenge.databaseName ?? undefined,
        challengePath: `/challenges/${challenge.id}`,
        challengeTitle: challenge.title,
        starterQuery: null,
        starterQueryConsumed: false,
      });

      router.push(`/lab/${session.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create submission.');
    } finally {
      setIsStartingSubmission(false);
    }
  };

  const pageLoading = catalogQuery.isLoading || mineQuery.isLoading;

  if (!challengeId) {
    return (
      <div className="page-shell page-stack">
        <p className="text-sm text-on-surface-variant">Invalid challenge.</p>
      </div>
    );
  }

  if (pageLoading) {
    return (
      <div className="page-shell page-stack">
        <div className="h-10 w-56 animate-pulse rounded bg-surface-container-low" />
        <div className="h-64 animate-pulse rounded-xl bg-surface-container-low" />
      </div>
    );
  }

  if (!challenge) {
    return (
      <div className="page-shell page-stack">
        <p className="text-sm text-on-surface-variant">Challenge not found.</p>
      </div>
    );
  }

  const showOwnerEditCard = isYours && challenge.status === 'draft';
  const isAdmin = user?.role === 'admin';

  return (
    <div className="page-shell page-stack">
      <Link href="/leaderboard" className="text-sm text-on-surface-variant hover:text-on-surface">
        ← Back to challenges
      </Link>

      {isYours ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full bg-primary/20 text-primary px-2 py-0.5">
            Yours
          </span>
          {!hasPublishedPlay ? (
            <span className="text-[10px] font-semibold uppercase tracking-wide rounded-full bg-amber-500/20 text-amber-200 px-2 py-0.5">
              Draft
            </span>
          ) : null}
        </div>
      ) : null}

      {showOwnerEditCard ? (
        <section className="rounded-xl border border-primary/25 bg-primary/5 p-5 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-headline text-base font-semibold text-on-surface">Edit your draft</h2>
              <p className="mt-1 text-xs text-on-surface-variant max-w-xl">
                Update wording, reference SQL, or pass criteria. Saving creates a new draft version for
                review (public) or for you to publish (private).
              </p>
            </div>
            <Button type="button" onClick={() => router.push(`/challenges/${challenge.id}/edit`)}>
              Edit draft
            </Button>
          </div>
        </section>
      ) : null}

      {isYours && challenge.status === 'published' ? (
        <section className="rounded-xl border border-outline-variant/15 bg-surface-container-low/50 p-5">
          <h2 className="font-headline text-base font-semibold text-on-surface">Published challenge</h2>
          <p className="mt-1 text-xs text-on-surface-variant">
            Learner-facing content is locked. For in-place edits you need the admin content tools.
          </p>
          {isAdmin ? (
            <Button
              type="button"
              variant="secondary"
              className="mt-3"
              onClick={() => router.push(`/admin/content/${challenge.id}/edit`)}
            >
              Open in admin
            </Button>
          ) : null}
        </section>
      ) : null}

      <section className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-headline text-2xl font-bold text-on-surface">{challenge.title}</h1>
            <p className="mt-2 text-sm text-on-surface-variant">{challenge.description}</p>
          </div>
          <DifficultyBadge difficulty={challenge.difficulty} />
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-on-surface-variant">
          <span>
            Points: <span className="font-semibold text-on-surface">{challenge.points}</span>
          </span>
          <span>
            Database:{' '}
            <span className="font-semibold text-on-surface">{challenge.databaseName ?? 'N/A'}</span>
          </span>
          <span>
            Attempts:{' '}
            <span className="font-semibold text-on-surface">{attemptsQuery.data?.length ?? 0}</span>
          </span>
          <span>
            Passed:{' '}
            <span className="font-semibold text-on-surface">
              {attemptsQuery.data?.filter((a) => a.status === 'passed').length ?? 0}
            </span>
          </span>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-6 space-y-4">
          <h2 className="font-headline text-lg font-semibold text-on-surface">Problem Statement</h2>
          <p className="text-sm leading-7 text-on-surface-variant whitespace-pre-wrap">
            {problemStatement || (draftQuery.isLoading ? 'Loading challenge content...' : '—')}
          </p>

          {hintText ? (
            <div className="rounded-lg border border-outline-variant/10 bg-surface-container p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-outline mb-2">Hint</p>
              <p className="text-sm text-on-surface-variant">{hintText}</p>
            </div>
          ) : null}

          {validatorConfigForDisplay ? (
            <div className="rounded-lg border border-outline-variant/10 bg-surface-container p-4">
              <p className="mb-3 text-xs uppercase tracking-[0.18em] text-outline">Pass criteria</p>
              <ChallengePassCriteriaDisplay
                validatorConfig={validatorConfigForDisplay}
                showExplainer={false}
              />
            </div>
          ) : null}
        </div>

        <div className="space-y-6">
          <section className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-6 space-y-4">
            <h2 className="font-headline text-lg font-semibold text-on-surface">Create submission</h2>
            <p className="text-xs text-on-surface-variant">
              <span className="uppercase tracking-[0.18em] text-outline">Dataset scale</span>
              :{' '}
              <span className="font-medium text-on-surface">
                {DATASET_SCALE_META[challenge.datasetScale].label}
              </span>
              <span className="text-on-surface-variant">
                {' '}
                — {DATASET_SCALE_META[challenge.datasetScale].desc}
              </span>
            </p>
            {!hasPublishedPlay ? (
              <p className="text-xs text-amber-200/90">
                This challenge is still a draft (not published). You cannot start a lab session until it
                is published.
              </p>
            ) : null}
            <Button
              variant="primary"
              onClick={() => void startSubmission()}
              loading={isStartingSubmission}
              disabled={!challenge.publishedVersionId}
              fullWidth
            >
              Create submission
            </Button>
          </section>

          <section className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-6">
            <h2 className="font-headline text-lg font-semibold text-on-surface">Top Leaderboard</h2>
            <p className="mt-1 text-xs text-on-surface-variant">
              Pass-only submissions; ranked by fastest runtime (shorter first), then lower cost as
              tie-breaker.
            </p>
            <div className="mt-3 space-y-2">
              {!challenge.publishedVersionId ? (
                <p className="text-sm text-on-surface-variant">No leaderboard until this challenge is published.</p>
              ) : leaderboardQuery.data?.length ? (
                leaderboardQuery.data.map((entry) => (
                  <div
                    key={entry.attemptId}
                    className="flex items-center justify-between gap-3 rounded-lg bg-surface-container px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-on-surface">
                        #{entry.rank} {entry.displayName || entry.username}
                      </p>
                      <p className="text-xs text-outline">{formatRelativeTime(entry.lastSubmittedAt)}</p>
                      <p className="mt-1 font-mono text-[11px] text-on-surface-variant">
                        {entry.bestDurationMs != null ? `${entry.bestDurationMs.toLocaleString()} ms` : '—'}
                        <span className="mx-1.5 text-outline">·</span>
                        cost{' '}
                        {entry.bestTotalCost != null
                          ? Math.round(entry.bestTotalCost).toLocaleString()
                          : '—'}
                      </p>
                    </div>
                    <StatusBadge status="success" />
                  </div>
                ))
              ) : (
                <p className="text-sm text-on-surface-variant">No leaderboard data yet.</p>
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
