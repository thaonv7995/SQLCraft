'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { DifficultyBadge } from '@/components/ui/badge';
import {
  challengesApi,
  leaderboardApi,
  lessonsApi,
  sessionsApi,
  type ChallengeCatalogItem,
  type DatasetScale,
} from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { saveLabBootstrap } from '@/lib/lab-bootstrap';

type LeaderboardPeriod = 'weekly' | 'monthly' | 'alltime';

const PERIOD_OPTIONS: Array<{ id: LeaderboardPeriod; label: string }> = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'alltime', label: 'All Time' },
];

function formatPoints(points: number) {
  return `${points.toLocaleString()} pts`;
}

const DATASET_SCALE_META: Record<DatasetScale, { label: string; desc: string }> = {
  tiny: { label: 'Tiny', desc: '100 rows' },
  small: { label: 'Small', desc: '10K rows' },
  medium: { label: 'Medium', desc: '1M-5M rows' },
  large: { label: 'Large', desc: '10M+ rows' },
};

type ChallengeCompletionFilter = 'not_done' | 'done';

export default function LeaderboardPage() {
  const [period, setPeriod] = useState<LeaderboardPeriod>('alltime');
  const { user } = useAuthStore();
  const userId = user?.id ?? null;

  const [completionScanLimit, setCompletionScanLimit] = useState(8);
  const [completionFilter, setCompletionFilter] = useState<ChallengeCompletionFilter>('not_done');
  const [completionPage, setCompletionPage] = useState(0);
  const completionPageSize = 6;

  const router = useRouter();
  const [submissionModalOpen, setSubmissionModalOpen] = useState(false);
  const [submissionChallenge, setSubmissionChallenge] = useState<ChallengeCatalogItem | null>(null);
  const [submissionSelectedScale, setSubmissionSelectedScale] = useState<DatasetScale>('small');
  const [isStartingSubmission, setIsStartingSubmission] = useState(false);

  useEffect(() => {
    setCompletionPage(0);
  }, [completionFilter]);

  const challengesQuery = useQuery({
    queryKey: ['published-challenges'],
    queryFn: () => challengesApi.listPublished(),
    staleTime: 60_000,
  });

  const leaderboardQuery = useQuery({
    queryKey: ['global-leaderboard', period],
    queryFn: () => leaderboardApi.get(period, 100),
    staleTime: 30_000,
  });

  const publishedChallenges = useMemo(() => challengesQuery.data ?? [], [challengesQuery.data]);
  const globalLeaders = useMemo(() => leaderboardQuery.data ?? [], [leaderboardQuery.data]);

  useEffect(() => {
    if (publishedChallenges.length === 0) return;
    const desired = Math.min(
      publishedChallenges.length,
      Math.max(8, (completionPage + 1) * completionPageSize),
    );
    setCompletionScanLimit((prev) => (prev < desired ? desired : prev));
  }, [publishedChallenges.length, completionPage, completionPageSize]);

  const meEntry = useMemo(() => {
    if (!userId) return null;
    return globalLeaders.find((entry) => entry.userId === userId) ?? null;
  }, [globalLeaders, userId]);

  const completionScanChallenges = useMemo(() => {
    const sliced = publishedChallenges.slice(0, completionScanLimit);
    // Skip challenges without a published version to query attempts.
    return sliced.filter((ch) => Boolean(ch.publishedVersionId));
  }, [publishedChallenges, completionScanLimit]);

  const passedChallengeIdsQuery = useQuery({
    queryKey: ['my-passed-challenges', userId, completionScanLimit],
    enabled: Boolean(userId && completionScanChallenges.length > 0),
    queryFn: async () => {
      const passedIds: string[] = [];

      // Keep requests bounded to reduce burst load.
      const chunkSize = 4;
      for (let i = 0; i < completionScanChallenges.length; i += chunkSize) {
        const chunk = completionScanChallenges.slice(i, i + chunkSize);
        const chunkResults = await Promise.all(
          chunk.map(async (challenge) => {
            if (!challenge.publishedVersionId) return { id: challenge.id, passed: false };

            const attempts = await challengesApi.listAttempts(challenge.publishedVersionId);
            const passed = attempts.some((a) => a.status === 'passed');
            return { id: challenge.id, passed };
          }),
        );

        passedIds.push(...chunkResults.filter((r) => r.passed).map((r) => r.id));
      }

      return passedIds;
    },
    staleTime: 15_000,
  });

  const passedChallengeIdsSet = useMemo(() => new Set(passedChallengeIdsQuery.data ?? []), [
    passedChallengeIdsQuery.data,
  ]);

  const scannedChallengeIdsSet = useMemo(
    () => new Set(completionScanChallenges.map((ch) => ch.id)),
    [completionScanChallenges],
  );

  const completedChallenges = useMemo(
    () => completionScanChallenges.filter((ch) => passedChallengeIdsSet.has(ch.id)),
    [completionScanChallenges, passedChallengeIdsSet],
  );

  const scanProgressLabel = useMemo(() => {
    const scanned = completionScanChallenges.length;
    const total = publishedChallenges.filter((ch) => Boolean(ch.publishedVersionId)).length;
    return `${scanned}/${total}`;
  }, [completionScanChallenges.length, publishedChallenges]);

  const canScanMore =
    publishedChallenges.length > 0 && completionScanLimit < publishedChallenges.length;

  const completionChallengesForList = useMemo(() => {
    const sorted = publishedChallenges
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
    return sorted.filter((ch) => {
      const passed = passedChallengeIdsSet.has(ch.id);
      return completionFilter === 'done' ? passed : !passed;
    });
  }, [publishedChallenges, completionFilter, passedChallengeIdsSet]);

  const completionTotalPages = Math.max(
    1,
    Math.ceil(completionChallengesForList.length / completionPageSize),
  );

  const completionSafePage = Math.min(completionPage, completionTotalPages - 1);

  const completionPageChallenges = useMemo(() => {
    const start = completionSafePage * completionPageSize;
    const end = start + completionPageSize;
    return completionChallengesForList.slice(start, end);
  }, [completionChallengesForList, completionSafePage, completionPageSize]);

  const openSubmissionModal = (challenge: ChallengeCatalogItem) => {
    setSubmissionChallenge(challenge);
    setSubmissionSelectedScale('small');
    setSubmissionModalOpen(true);
  };

  const closeSubmissionModal = () => {
    setSubmissionModalOpen(false);
    setSubmissionChallenge(null);
  };

  const startSubmissionForChallenge = async () => {
    if (!submissionChallenge?.publishedVersionId) {
      toast.error('Challenge chưa sẵn sàng để tạo submission.');
      return;
    }

    setIsStartingSubmission(true);
    try {
      const lesson = await lessonsApi.get(submissionChallenge.lessonId);
      const lessonPublishedVersionId = lesson.publishedVersionId;

      if (!lessonPublishedVersionId) {
        throw new Error('Practice set chưa được publish.');
      }

      const lessonVersion = await lessonsApi.getVersion(lessonPublishedVersionId);

      const session = await sessionsApi.create({
        lessonVersionId: lessonPublishedVersionId,
        challengeVersionId: submissionChallenge.publishedVersionId,
        selectedScale: submissionSelectedScale,
      });

      saveLabBootstrap(session.id, {
        mode: 'challenge',
        lessonPath: `/tracks/${submissionChallenge.trackId}/lessons/${submissionChallenge.lessonId}`,
        lessonTitle: submissionChallenge.lessonTitle,
        challengePath: `/tracks/${submissionChallenge.trackId}/lessons/${submissionChallenge.lessonId}/challenges/${submissionChallenge.id}`,
        challengeTitle: submissionChallenge.title,
        starterQuery: lessonVersion.starterQuery ?? null,
        starterQueryConsumed: false,
      });

      closeSubmissionModal();
      router.push(`/lab/${session.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thể tạo submission.');
    } finally {
      setIsStartingSubmission(false);
    }
  };

  return (
    <div className="page-shell page-stack">
      <section className="space-y-5 rounded-[28px] border border-outline-variant/10 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.12),transparent_38%),radial-gradient(circle_at_bottom_right,rgba(245,158,11,0.15),transparent_36%),var(--surface-container-low)] px-6 py-6">
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.24em] text-outline">Challenge hub</p>
          <h1 className="font-headline text-4xl font-bold tracking-tight text-on-surface">Challenges</h1>
          <p className="max-w-3xl text-base leading-7 text-on-surface-variant">
            Điểm và tiến độ của bạn theo từng khoảng thời gian. Chọn challenge để xem problem statement và
            nộp submission.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl border border-outline-variant/10 bg-surface/80 px-4 py-4 backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Điểm của bạn</p>
            <p className="mt-2 text-2xl font-semibold text-on-surface">
              {meEntry ? formatPoints(meEntry.points) : '—'}
            </p>
            <p className="mt-1 text-sm text-on-surface-variant">Tính theo bảng xếp hạng {period}</p>
          </div>
          <div className="rounded-2xl border border-outline-variant/10 bg-surface/80 px-4 py-4 backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Đã pass</p>
            <p className="mt-2 text-2xl font-semibold text-on-surface">
              {meEntry ? meEntry.challengesCompleted : '—'}
            </p>
            <p className="mt-1 text-sm text-on-surface-variant">Số challenge bạn đã hoàn thành</p>
          </div>
          <div className="rounded-2xl border border-outline-variant/10 bg-surface/80 px-4 py-4 backdrop-blur">
            <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Streak</p>
            <p className="mt-2 text-2xl font-semibold text-on-surface">
              {meEntry ? `${meEntry.streak} ngày` : '—'}
            </p>
            <p className="mt-1 text-sm text-on-surface-variant">Chuỗi ngày bạn duy trì nhịp làm bài</p>
          </div>
        </div>
      </section>

      <section>
        <div className="flex items-center justify-between mb-8">
          <h2 className="font-headline text-xl font-medium flex items-center gap-2">
            <span className="w-1.5 h-6 bg-tertiary rounded-full shrink-0" />
            Available Challenges
            <span className="text-sm font-normal text-outline ml-1">({completionChallengesForList.length})</span>
          </h2>

          <div className="flex items-center gap-2">
            {PERIOD_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setPeriod(option.id)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  period === option.id
                    ? 'bg-surface-container-high text-on-surface'
                    : 'bg-surface text-on-surface-variant hover:text-on-surface',
                )}
              >
                {option.label}
              </button>
            ))}
            {(
              [
                { id: 'not_done', label: 'Chưa làm' },
                { id: 'done', label: 'Đã làm' },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setCompletionFilter(t.id);
                  setCompletionPage(0);
                }}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                  completionFilter === t.id
                    ? 'bg-surface-container-high text-on-surface'
                    : 'bg-surface text-on-surface-variant hover:text-on-surface',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {challengesQuery.isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-surface-container-low rounded-xl p-6 space-y-4">
                <div className="flex items-start justify-between">
                  <div className="w-12 h-12 bg-surface-container-high rounded-lg animate-pulse" />
                  <div className="w-16 h-5 bg-surface-container-high rounded animate-pulse" />
                </div>
                <div className="space-y-2">
                  <div className="h-4 w-3/4 bg-surface-container-high rounded animate-pulse" />
                  <div className="h-3 w-full bg-surface-container-high rounded animate-pulse" />
                  <div className="h-3 w-5/6 bg-surface-container-high rounded animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : challengesQuery.isError ? (
          <div className="bg-surface-container-low rounded-xl p-16 flex flex-col items-center text-center">
            <span className="material-symbols-outlined text-4xl text-outline mb-3">error</span>
            <p className="text-sm font-medium text-on-surface mb-1">Challenge catalog unavailable</p>
            <p className="text-xs text-on-surface-variant">Không thể tải danh sách challenge.</p>
          </div>
        ) : completionChallengesForList.length === 0 ? (
          <div className="bg-surface-container-low rounded-xl p-16 flex flex-col items-center text-center">
            <span className="material-symbols-outlined text-4xl text-outline mb-3">search_off</span>
            <p className="text-sm font-medium text-on-surface mb-1">No challenges found</p>
            <p className="text-xs text-on-surface-variant">Thử đổi filter trạng thái hoặc kỳ leaderboard.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {completionPageChallenges.map((challenge) => {
                const scanned = scannedChallengeIdsSet.has(challenge.id);
                const passed = passedChallengeIdsSet.has(challenge.id);

                return (
                  <div
                    key={challenge.id}
                    className="group bg-surface-container-low rounded-xl p-6 relative overflow-hidden border border-transparent hover:border-outline-variant/20 transition-all duration-200 hover:bg-surface-container"
                  >
                    <span className="material-symbols-outlined absolute top-4 right-4 text-outline text-base opacity-0 group-hover:opacity-100 transition-opacity">
                      open_in_new
                    </span>

                    <div className="flex items-start justify-between mb-4">
                      <div className="w-12 h-12 rounded-lg bg-surface-container-highest flex items-center justify-center">
                        <span
                          className="material-symbols-outlined text-2xl text-tertiary"
                          style={{ fontVariationSettings: "'FILL' 1" }}
                        >
                          quiz
                        </span>
                      </div>
                      <DifficultyBadge difficulty={challenge.difficulty} />
                    </div>

                    <h3 className="font-headline text-base font-bold text-on-surface group-hover:text-primary transition-colors mb-1.5">
                      {challenge.title}
                    </h3>

                    <p className="text-xs text-outline leading-relaxed line-clamp-2 mb-4">
                      {challenge.description}
                    </p>

                    <div className="flex items-center gap-2 mb-4 flex-wrap">
                      {passed ? (
                        <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs text-success inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">check_circle</span>
                          Đã pass
                        </span>
                      ) : scanned ? (
                        <span className="rounded-full bg-outline-variant/10 px-2 py-0.5 text-xs text-on-surface-variant inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">radio_button_unchecked</span>
                          Chưa pass
                        </span>
                      ) : (
                        <span className="rounded-full bg-surface-container-lowest/50 px-2 py-0.5 text-xs text-on-surface-variant inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">help_outline</span>
                          Chưa xác minh
                        </span>
                      )}

                      <span className="rounded-full bg-secondary/10 px-2 py-0.5 text-xs text-secondary font-mono">
                        {challenge.points} pts
                      </span>
                    </div>

                    <div className="border-t border-outline-variant/10 pt-4 grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-outline mb-1">
                          Points
                        </p>
                        <p className="text-sm font-mono font-bold text-on-surface">
                          {challenge.points} pts
                        </p>
                      </div>
                      <div>
                        <p className="text-[9px] font-bold uppercase tracking-widest text-outline mb-1">
                          Lesson
                        </p>
                        <p className="text-sm font-mono font-bold text-tertiary line-clamp-1">
                          {challenge.lessonTitle}
                        </p>
                        <p className="text-[10px] text-on-surface-variant mt-1 line-clamp-1">
                          {challenge.trackTitle}
                        </p>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => openSubmissionModal(challenge)}
                        aria-label={`Tạo submission cho ${challenge.title}`}
                        className="inline-flex shrink-0 items-center gap-2 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary transition hover:brightness-105"
                      >
                        Tạo submission
                        <span className="material-symbols-outlined text-sm">add_circle</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 flex items-center justify-between gap-3">
              <p className="text-xs text-on-surface-variant">
                Trang {completionSafePage + 1}/{completionTotalPages}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={completionSafePage <= 0}
                  onClick={() => setCompletionPage((p) => Math.max(0, p - 1))}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                    completionSafePage <= 0
                      ? 'border-outline-variant/10 bg-surface-container-low text-on-surface-variant/60 cursor-not-allowed'
                      : 'border-outline-variant/20 bg-surface-container-high text-on-surface hover:bg-surface-container-highest',
                  )}
                >
                  Trước
                </button>
                <button
                  type="button"
                  disabled={completionSafePage >= completionTotalPages - 1}
                  onClick={() => setCompletionPage((p) => Math.min(completionTotalPages - 1, p + 1))}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                    completionSafePage >= completionTotalPages - 1
                      ? 'border-outline-variant/10 bg-surface-container-low text-on-surface-variant/60 cursor-not-allowed'
                      : 'border-outline-variant/20 bg-surface-container-high text-on-surface hover:bg-surface-container-highest',
                  )}
                >
                  Sau
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {submissionModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="submission-modal-title"
        >
          <div className="w-full max-w-md rounded-[28px] border border-outline-variant/20 bg-surface-container-low p-6 shadow-[0_24px_80px_rgba(0,0,0,0.6)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="submission-modal-title" className="font-headline text-xl font-semibold text-on-surface">
                  Chọn database (dataset scale)
                </h2>
                <p className="mt-1 text-sm text-on-surface-variant">
                  Bạn sẽ tạo submission bằng sandbox theo quy mô này.
                </p>
              </div>
              <button
                type="button"
                onClick={closeSubmissionModal}
                className="rounded-full border border-outline-variant/20 bg-surface-container-low px-3 py-1.5 text-sm text-on-surface-variant hover:bg-surface-container-lowest"
                aria-label="Đóng popup"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-outline">Dataset scale</p>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(DATASET_SCALE_META) as DatasetScale[]).map((scale) => (
                  <button
                    key={scale}
                    type="button"
                    onClick={() => setSubmissionSelectedScale(scale)}
                    className={cn(
                      'rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                      submissionSelectedScale === scale
                        ? 'bg-surface-container-high text-on-surface'
                        : 'bg-surface text-on-surface-variant hover:text-on-surface',
                    )}
                    title={DATASET_SCALE_META[scale].desc}
                  >
                    {DATASET_SCALE_META[scale].label}
                  </button>
                ))}
              </div>

              <div className="rounded-2xl border border-outline-variant/10 bg-surface-container-low/50 px-4 py-3">
                <p className="text-xs text-on-surface-variant">
                  Challenge: <span className="text-on-surface">{submissionChallenge?.title ?? '—'}</span>
                </p>
                <p className="mt-1 text-xs text-on-surface-variant">
                  Scale: <span className="font-mono text-on-surface">{submissionSelectedScale}</span>
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={closeSubmissionModal}
                className="rounded-full border border-outline-variant/20 bg-surface-container-low px-4 py-2 text-sm font-medium text-on-surface-variant transition hover:bg-surface-container-lowest"
                disabled={isStartingSubmission}
              >
                Hủy
              </button>

              <button
                type="button"
                onClick={() => void startSubmissionForChallenge()}
                disabled={isStartingSubmission}
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-semibold text-on-primary transition hover:brightness-105 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isStartingSubmission ? (
                  <span className="material-symbols-outlined text-base animate-spin">autorenew</span>
                ) : (
                  <span className="material-symbols-outlined text-base">add_circle</span>
                )}
                Tạo submission
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
