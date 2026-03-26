'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { DifficultyBadge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  challengesApi,
  sessionsApi,
  type ChallengeCatalogItem,
  type DatasetScale,
} from '@/lib/api';
import { saveLabBootstrap } from '@/lib/lab-bootstrap';
import { useAuthStore } from '@/stores/auth';
import { formatRelativeTime } from '@/lib/utils';

const DATASET_SCALE_META: Record<DatasetScale, { label: string; desc: string }> = {
  tiny: { label: 'Tiny', desc: '100 rows' },
  small: { label: 'Small', desc: '10K rows' },
  medium: { label: 'Medium', desc: '1M-5M rows' },
  large: { label: 'Large', desc: '10M+ rows' },
};

function challengeIdFromPathname(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const lastSegment = segments[segments.length - 1];
  return lastSegment ? decodeURIComponent(lastSegment) : '';
}

export default function ChallengeDetailPage() {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuthStore();
  const challengeId = challengeIdFromPathname(pathname);
  const [selectedScale, setSelectedScale] = useState<DatasetScale>('small');
  const [isStartingSubmission, setIsStartingSubmission] = useState(false);

  const catalogQuery = useQuery({
    queryKey: ['published-challenges'],
    queryFn: () => challengesApi.listPublished(),
    staleTime: 60_000,
  });

  const challenge = useMemo<ChallengeCatalogItem | null>(
    () => catalogQuery.data?.find((item) => item.id === challengeId) ?? null,
    [catalogQuery.data, challengeId],
  );

  const versionQuery = useQuery({
    queryKey: ['challenge-version-detail', challenge?.publishedVersionId],
    enabled: Boolean(challenge?.publishedVersionId),
    queryFn: () => challengesApi.getVersion(challenge!.publishedVersionId!),
    staleTime: 30_000,
  });

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
      toast.error('Challenge chưa sẵn sàng để tạo submission.');
      return;
    }

    setIsStartingSubmission(true);
    try {
      const session = await sessionsApi.create({
        challengeVersionId: challenge.publishedVersionId,
        selectedScale,
      });

      saveLabBootstrap(session.id, {
        mode: 'challenge',
        lessonTitle: challenge.databaseName ?? undefined,
        challengePath: `/challenges/${challenge.id}`,
        challengeTitle: challenge.title,
        starterQuery: null,
        starterQueryConsumed: false,
      });

      router.push(`/lab/${session.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thể tạo submission.');
    } finally {
      setIsStartingSubmission(false);
    }
  };

  if (!challengeId) {
    return (
      <div className="page-shell page-stack">
        <p className="text-sm text-on-surface-variant">Challenge không hợp lệ.</p>
      </div>
    );
  }

  if (catalogQuery.isLoading) {
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
        <p className="text-sm text-on-surface-variant">Không tìm thấy challenge.</p>
      </div>
    );
  }

  return (
    <div className="page-shell page-stack">
      <Link href="/leaderboard" className="text-sm text-on-surface-variant hover:text-on-surface">
        ← Back to challenges
      </Link>

      <section className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-headline text-2xl font-bold text-on-surface">{challenge.title}</h1>
            <p className="mt-2 text-sm text-on-surface-variant">{challenge.description}</p>
          </div>
          <DifficultyBadge difficulty={challenge.difficulty} />
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs text-on-surface-variant">
          <span>Points: <span className="font-semibold text-on-surface">{challenge.points}</span></span>
          <span>Database: <span className="font-semibold text-on-surface">{challenge.databaseName ?? 'N/A'}</span></span>
          <span>Attempts: <span className="font-semibold text-on-surface">{attemptsQuery.data?.length ?? 0}</span></span>
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
            {versionQuery.data?.problemStatement ?? 'Đang tải nội dung challenge...'}
          </p>

          {versionQuery.data?.hintText ? (
            <div className="rounded-lg border border-outline-variant/10 bg-surface-container p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-outline mb-2">Hint</p>
              <p className="text-sm text-on-surface-variant">{versionQuery.data.hintText}</p>
            </div>
          ) : null}

          {versionQuery.data?.expectedResultColumns?.length ? (
            <div className="rounded-lg border border-outline-variant/10 bg-surface-container p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-outline mb-2">Expected Columns</p>
              <div className="flex flex-wrap gap-2">
                {versionQuery.data.expectedResultColumns.map((column) => (
                  <code key={column} className="rounded-md bg-surface-container-high px-2 py-1 text-xs">
                    {column}
                  </code>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-6">
          <section className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-6 space-y-4">
            <h2 className="font-headline text-lg font-semibold text-on-surface">Tạo Submission</h2>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.18em] text-outline">Dataset scale</p>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(DATASET_SCALE_META) as DatasetScale[]).map((scale) => (
                  <button
                    key={scale}
                    type="button"
                    onClick={() => setSelectedScale(scale)}
                    className={
                      selectedScale === scale
                        ? 'rounded-full bg-surface-container-high px-3 py-1.5 text-xs font-medium text-on-surface'
                        : 'rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-on-surface-variant'
                    }
                    title={DATASET_SCALE_META[scale].desc}
                  >
                    {DATASET_SCALE_META[scale].label}
                  </button>
                ))}
              </div>
            </div>
            <Button
              variant="primary"
              onClick={() => void startSubmission()}
              loading={isStartingSubmission}
              disabled={!challenge.publishedVersionId}
              fullWidth
            >
              Tạo submission
            </Button>
          </section>

          <section className="rounded-xl border border-outline-variant/10 bg-surface-container-low p-6">
            <h2 className="font-headline text-lg font-semibold text-on-surface mb-3">Top Leaderboard</h2>
            <div className="space-y-2">
              {leaderboardQuery.data?.length ? (
                leaderboardQuery.data.map((entry) => (
                  <div key={entry.attemptId} className="flex items-center justify-between rounded-lg bg-surface-container px-3 py-2">
                    <div>
                      <p className="text-sm font-medium text-on-surface">#{entry.rank} {entry.displayName || entry.username}</p>
                      <p className="text-xs text-outline">{formatRelativeTime(entry.lastSubmittedAt)}</p>
                    </div>
                    <StatusBadge status="success" />
                  </div>
                ))
              ) : (
                <p className="text-sm text-on-surface-variant">Chưa có dữ liệu leaderboard.</p>
              )}
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}

