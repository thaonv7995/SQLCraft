'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/stores/auth';
import { Badge, DifficultyBadge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  challengesApi,
  lessonsApi,
  sessionsApi,
  type ChallengeAttempt,
  type ChallengeEvaluation,
  type ChallengeLeaderboardEntry,
  type ChallengeVersionDetail,
} from '@/lib/api';
import { saveLabBootstrap } from '@/lib/lab-bootstrap';
import { cn, formatDuration, formatMinutes, formatRelativeTime, generateInitials, truncateSql } from '@/lib/utils';

type SessionListItem = Awaited<ReturnType<typeof sessionsApi.list>>[number];
type SignalTone = 'default' | 'success' | 'warning';

function ChallengePageSkeleton() {
  return (
    <div className="page-shell-wide page-stack">
      <div className="h-8 w-48 animate-pulse rounded bg-surface-container-low" />
      <div className="h-[28rem] animate-pulse rounded-[2rem] bg-surface-container-low" />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(20rem,0.95fr)]">
        <div className="space-y-6">
          <div className="h-72 animate-pulse rounded-[1.75rem] bg-surface-container-low" />
          <div className="h-80 animate-pulse rounded-[1.75rem] bg-surface-container-low" />
        </div>
        <div className="space-y-6">
          <div className="h-80 animate-pulse rounded-[1.75rem] bg-surface-container-low" />
          <div className="h-72 animate-pulse rounded-[1.75rem] bg-surface-container-low" />
        </div>
      </div>
      <div className="h-[28rem] animate-pulse rounded-[1.75rem] bg-surface-container-low" />
    </div>
  );
}

function normalizeMetric(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compareNullableAscending(left: number | null, right: number | null) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function formatDurationMetric(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? formatDuration(Math.max(0, value)) : '—';
}

function formatCostMetric(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '—';
}

function AttemptStatusBadge({ status }: { status: string }) {
  if (status === 'passed') {
    return <Badge variant="success" dot>Đạt</Badge>;
  }

  if (status === 'failed' || status === 'error') {
    return <Badge variant="error" dot>{status === 'failed' ? 'Chưa đạt' : 'Lỗi'}</Badge>;
  }

  return <StatusBadge status={status} />;
}

function resolveChallengeRules(detail: ChallengeVersionDetail) {
  const config =
    detail.validatorConfig && typeof detail.validatorConfig === 'object'
      ? detail.validatorConfig
      : {};
  const baselineDurationMs =
    typeof config.baselineDurationMs === 'number' ? config.baselineDurationMs : null;
  const requiresIndexOptimization = config.requiresIndexOptimization === true;
  const totalPoints = Math.max(0, detail.points ?? 100);

  return {
    rewardPoints: totalPoints,
    baselineDurationMs,
    requiresIndexOptimization,
  };
}

function MissionStatCard({
  label,
  value,
  supporting,
  accent = 'default',
}: {
  label: string;
  value: string;
  supporting: string;
  accent?: SignalTone;
}) {
  const accentClasses =
    accent === 'success'
      ? 'border-secondary/20 bg-secondary/10'
      : accent === 'warning'
        ? 'border-tertiary/20 bg-tertiary/10'
        : 'border-outline-variant/10 bg-surface-container-low/80';

  return (
    <div className={cn('rounded-[1.35rem] border px-4 py-4', accentClasses)}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-on-surface">{value}</p>
      <p className="mt-2 text-sm leading-6 text-on-surface-variant">{supporting}</p>
    </div>
  );
}

function MissionLoopItem({
  step,
  title,
  description,
}: {
  step: string;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[1.25rem] border border-outline-variant/10 bg-surface-container-low/70 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">{step}</p>
      <p className="mt-2 text-base font-semibold text-on-surface">{title}</p>
      <p className="mt-2 text-sm leading-6 text-on-surface-variant">{description}</p>
    </div>
  );
}

function ConditionRow({
  title,
  description,
  statusLabel,
  tone,
  icon,
}: {
  title: string;
  description: string;
  statusLabel: string;
  tone: SignalTone;
  icon: string;
}) {
  const iconClasses =
    tone === 'success'
      ? 'bg-secondary/15 text-secondary'
      : tone === 'warning'
        ? 'bg-tertiary/15 text-tertiary'
        : 'bg-surface-container-high text-on-surface-variant';

  return (
    <div className="flex items-start gap-3 rounded-[1.25rem] border border-outline-variant/10 bg-surface-container-low/70 p-4">
      <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl', iconClasses)}>
        <span className="material-symbols-outlined text-[20px]">{icon}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-on-surface">{title}</p>
          <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-medium text-on-surface-variant">
            {statusLabel}
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-on-surface-variant">{description}</p>
      </div>
    </div>
  );
}

function PersonalSignalRow({
  label,
  value,
  supporting,
}: {
  label: string;
  value: string;
  supporting: string;
}) {
  return (
    <div className="rounded-[1.1rem] border border-outline-variant/10 bg-surface-container-low/70 px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">{label}</p>
        <p className="text-base font-semibold text-on-surface">{value}</p>
      </div>
      <p className="mt-2 text-sm leading-6 text-on-surface-variant">{supporting}</p>
    </div>
  );
}

function AttemptEvaluationSummary({ evaluation }: { evaluation: ChallengeEvaluation | null | undefined }) {
  if (!evaluation) {
    return null;
  }

  const items = [
    typeof evaluation.score === 'number' && typeof evaluation.pointsPossible === 'number'
      ? {
          label: evaluation.passesChallenge ? 'Điểm mở khóa' : 'Điểm hiện tại',
          value: evaluation.passesChallenge
            ? `${evaluation.score}/${evaluation.pointsPossible}`
            : `0/${evaluation.pointsPossible}`,
        }
      : null,
    evaluation.baselineDurationMs != null
      ? {
          label: 'Mốc thời gian',
          value:
            evaluation.meetsPerformanceTarget === false
              ? `${formatDurationMetric(evaluation.latestDurationMs)} / ${formatDurationMetric(evaluation.baselineDurationMs)}`
              : `${formatDurationMetric(evaluation.baselineDurationMs)}`,
        }
      : null,
    evaluation.latestDurationMs != null
      ? {
          label: 'Run đã ghi nhận',
          value: formatDurationMetric(evaluation.latestDurationMs),
        }
      : null,
    evaluation.requiresIndexOptimization
      ? {
          label: 'Index evidence',
          value: evaluation.usedIndexing ? 'Đủ bằng chứng' : 'Chưa xác nhận',
        }
      : null,
  ].filter((item): item is { label: string; value: string } => item !== null);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-on-surface-variant">
      {items.map((item) => (
        <span key={item.label} className="rounded-full bg-surface px-2.5 py-1">
          {item.label}: {item.value}
        </span>
      ))}
    </div>
  );
}

function AttemptTimelineItem({
  attempt,
  rewardPoints,
}: {
  attempt: ChallengeAttempt;
  rewardPoints: number;
}) {
  return (
    <div className="rounded-[1.35rem] border border-outline-variant/10 bg-surface-container-low/70 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <AttemptStatusBadge status={attempt.status} />
        <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-medium text-on-surface-variant">
          Attempt #{attempt.attemptNo}
        </span>
        <span className="text-sm font-semibold text-on-surface">
          {attempt.status === 'passed' ? `+${rewardPoints} pts` : 'Reward locked'}
        </span>
        <span className="ml-auto text-xs text-outline">{formatRelativeTime(attempt.submittedAt)}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-on-surface-variant">
        <span className="rounded-full bg-surface px-2.5 py-1">
          Query {attempt.queryExecution.status}
        </span>
        {attempt.queryExecution.rowsReturned != null ? (
          <span className="rounded-full bg-surface px-2.5 py-1">
            {attempt.queryExecution.rowsReturned} rows
          </span>
        ) : null}
        {attempt.queryExecution.durationMs != null ? (
          <span className="rounded-full bg-surface px-2.5 py-1">
            {formatDurationMetric(attempt.queryExecution.durationMs)}
          </span>
        ) : null}
        {attempt.queryExecution.totalCost != null ? (
          <span className="rounded-full bg-surface px-2.5 py-1">
            cost {formatCostMetric(attempt.queryExecution.totalCost)}
          </span>
        ) : null}
      </div>

      <p className="mt-3 text-xs leading-6 text-on-surface-variant">
        {truncateSql(attempt.queryExecution.sqlText, 180)}
      </p>

      {attempt.evaluation?.feedbackText ? (
        <>
          <p className="mt-3 text-sm leading-6 text-on-surface-variant">{attempt.evaluation.feedbackText}</p>
          <AttemptEvaluationSummary evaluation={attempt.evaluation} />
        </>
      ) : null}
    </div>
  );
}

function LeaderboardCard({
  entry,
  highlight,
}: {
  entry: ChallengeLeaderboardEntry;
  highlight: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-[1.25rem] border px-4 py-3',
        highlight
          ? 'border-secondary/25 bg-secondary/10'
          : 'border-outline-variant/10 bg-surface-container-low/70',
      )}
    >
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface text-sm font-semibold text-on-surface">
        #{entry.rank}
      </div>

      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-container-high text-sm font-semibold text-on-surface-variant">
        {generateInitials(entry.displayName)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-on-surface">{entry.displayName}</p>
          {highlight ? <Badge variant="success">Bạn</Badge> : null}
        </div>
        <p className="text-xs text-on-surface-variant">
          {entry.attemptsCount} attempts • {entry.passedAttempts} passed
        </p>
        <p className="mt-2 truncate font-mono text-[11px] text-on-surface-variant">{entry.sqlText}</p>
      </div>

      <div className="text-right">
        <p className="text-sm font-semibold text-secondary">{formatDurationMetric(entry.bestDurationMs)}</p>
        <p className="text-[11px] text-outline">
          cost {formatCostMetric(entry.bestTotalCost)} • {formatRelativeTime(entry.lastSubmittedAt)}
        </p>
      </div>
    </div>
  );
}

function resolveChallengeState({
  bestAttempt,
  latestAttempt,
  resumableSession,
}: {
  bestAttempt: ChallengeAttempt | null;
  latestAttempt: ChallengeAttempt | null;
  resumableSession: SessionListItem | null;
}) {
  if (bestAttempt) {
    return {
      label: 'Đã unlock challenge',
      description: 'Bạn đã có ít nhất một run hợp lệ. Giờ mục tiêu là tiếp tục tune để kéo runtime và cost xuống thấp hơn.',
      icon: 'military_tech',
      tone: 'success' as const,
    };
  }

  if (latestAttempt?.status === 'failed' || latestAttempt?.status === 'error') {
    return {
      label: 'Đang tuning để pass',
      description: 'Run mới nhất chưa qua toàn bộ điều kiện. Xem checklist pass bên dưới để biết bạn còn thiếu gì.',
      icon: 'tune',
      tone: 'warning' as const,
    };
  }

  if (resumableSession) {
    return {
      label: 'Lab đang mở',
      description: 'Bạn đã có sandbox sẵn. Tiếp tục lab hiện tại để chạy thêm query hoặc submit một run mới.',
      icon: 'terminal',
      tone: 'default' as const,
    };
  }

  return {
    label: 'Sẵn sàng xuất phát',
    description: 'Challenge này đang chờ run đầu tiên của bạn. Mở Challenge Lab để bắt đầu từ starter query của lesson.',
    icon: 'flag',
    tone: 'default' as const,
  };
}

export default function ChallengePage() {
  const params = useParams<{
    trackId: string;
    lessonId: string;
    challengeId: string;
  }>();
  const router = useRouter();
  const viewerId = useAuthStore((state) => state.user?.id ?? null);
  const [starting, setStarting] = useState(false);

  const { data: lesson, isLoading: lessonLoading } = useQuery({
    queryKey: ['lesson', params.lessonId],
    queryFn: () => lessonsApi.get(params.lessonId),
    staleTime: 60_000,
  });

  const {
    data: lessonVersion,
    isLoading: versionLoading,
    error: versionError,
    refetch: refetchVersion,
  } = useQuery({
    queryKey: ['lesson-version-for-challenge', lesson?.publishedVersionId],
    queryFn: () => lessonsApi.getVersion(lesson!.publishedVersionId!),
    enabled: Boolean(lesson?.publishedVersionId),
    staleTime: 60_000,
  });

  const challengeSummary =
    lessonVersion?.challenges.find((item) => item.id === params.challengeId) ?? null;

  const {
    data: challengeVersion,
    isLoading: challengeLoading,
    error: challengeError,
    refetch: refetchChallenge,
  } = useQuery({
    queryKey: ['challenge-version-detail', challengeSummary?.publishedVersionId],
    queryFn: () => challengesApi.getVersion(challengeSummary!.publishedVersionId!),
    enabled: Boolean(challengeSummary?.publishedVersionId),
    staleTime: 60_000,
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ['challenge-page-sessions'],
    queryFn: () => sessionsApi.list(),
    staleTime: 30_000,
  });

  const { data: attempts = [] } = useQuery({
    queryKey: ['challenge-attempts', challengeSummary?.publishedVersionId],
    queryFn: () => challengesApi.listAttempts(challengeSummary!.publishedVersionId!),
    enabled: Boolean(challengeSummary?.publishedVersionId),
    staleTime: 15_000,
  });

  const { data: leaderboard = [] } = useQuery({
    queryKey: ['challenge-leaderboard', challengeSummary?.publishedVersionId],
    queryFn: () => challengesApi.getLeaderboard(challengeSummary!.publishedVersionId!, 8),
    enabled: Boolean(challengeSummary?.publishedVersionId),
    staleTime: 30_000,
  });

  const resumableSession =
    lessonVersion && challengeSummary?.publishedVersionId
      ? sessions.find(
          (session) =>
            session.lessonVersionId === lessonVersion.id &&
            session.challengeVersionId === challengeSummary.publishedVersionId &&
            (session.status === 'active' ||
              session.status === 'paused' ||
              session.status === 'provisioning'),
        ) ?? null
      : null;

  const sortedAttempts = attempts
    .slice()
    .sort((left, right) => new Date(right.submittedAt).getTime() - new Date(left.submittedAt).getTime());

  const rankedEntries = leaderboard
    .slice()
    .sort((left, right) => left.rank - right.rank || left.displayName.localeCompare(right.displayName));

  const bestAttempt = sortedAttempts
    .filter((attempt) => attempt.status === 'passed')
    .reduce<ChallengeAttempt | null>((best, attempt) => {
      if (!best) {
        return attempt;
      }

      const durationComparison = compareNullableAscending(
        normalizeMetric(attempt.queryExecution.durationMs),
        normalizeMetric(best.queryExecution.durationMs),
      );
      if (durationComparison < 0) {
        return attempt;
      }
      if (durationComparison > 0) {
        return best;
      }

      const costComparison = compareNullableAscending(
        normalizeMetric(attempt.queryExecution.totalCost),
        normalizeMetric(best.queryExecution.totalCost),
      );
      if (costComparison < 0) {
        return attempt;
      }
      if (costComparison > 0) {
        return best;
      }

      return new Date(attempt.submittedAt) < new Date(best.submittedAt) ? attempt : best;
    }, null);

  const latestAttempt = sortedAttempts[0] ?? null;

  const handleStartChallengeLab = async () => {
    if (!lessonVersion || !challengeSummary?.publishedVersionId) {
      toast.error('Challenge này chưa sẵn sàng');
      return;
    }

    setStarting(true);

    try {
      const session = await sessionsApi.create({
        lessonVersionId: lessonVersion.id,
        challengeVersionId: challengeSummary.publishedVersionId,
      });

      saveLabBootstrap(session.id, {
        mode: 'challenge',
        lessonPath: `/tracks/${params.trackId}/lessons/${params.lessonId}`,
        lessonTitle: lessonVersion.lesson?.title ?? lesson?.title ?? 'Lesson',
        challengePath: `/tracks/${params.trackId}/lessons/${params.lessonId}/challenges/${params.challengeId}`,
        challengeTitle: challengeSummary.title,
        starterQuery: lessonVersion.starterQuery ?? null,
        starterQueryConsumed: false,
      });

      router.push(`/lab/${session.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Không thể mở Challenge Lab');
      setStarting(false);
    }
  };

  const handleContinueChallengeLab = () => {
    if (!resumableSession) {
      return;
    }

    saveLabBootstrap(resumableSession.id, {
      mode: 'challenge',
      lessonPath: `/tracks/${params.trackId}/lessons/${params.lessonId}`,
      lessonTitle: lessonVersion?.lesson?.title ?? lesson?.title ?? 'Lesson',
      challengePath: `/tracks/${params.trackId}/lessons/${params.lessonId}/challenges/${params.challengeId}`,
      challengeTitle: challengeSummary?.title ?? 'Challenge',
      starterQuery: lessonVersion?.starterQuery ?? null,
      starterQueryConsumed: true,
    });
    router.push(`/lab/${resumableSession.id}`);
  };

  if (
    lessonLoading ||
    (Boolean(lesson?.publishedVersionId) && versionLoading) ||
    (Boolean(challengeSummary?.publishedVersionId) && challengeLoading)
  ) {
    return <ChallengePageSkeleton />;
  }

  if (
    !lesson ||
    !lessonVersion ||
    !challengeSummary ||
    !challengeSummary.publishedVersionId ||
    !challengeVersion ||
    versionError ||
    challengeError
  ) {
    return (
      <div className="page-shell-wide page-stack">
        <Link
          href={`/tracks/${params.trackId}/lessons/${params.lessonId}`}
          className="inline-flex w-fit items-center gap-2 text-sm text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <span className="material-symbols-outlined text-base">arrow_back</span>
          Quay lại lesson
        </Link>

        <Card className="rounded-[1.75rem] border border-outline-variant/10">
          <CardContent className="flex flex-col gap-4 py-8">
            <div className="flex items-center gap-3">
              <span className="material-symbols-outlined text-3xl text-outline">target</span>
              <div>
                <CardTitle>Không thể tải challenge</CardTitle>
                <CardDescription className="mt-1">
                  {challengeError instanceof Error
                    ? challengeError.message
                    : versionError instanceof Error
                      ? versionError.message
                      : 'Challenge này chưa thể lấy từ phiên bản lesson đã publish.'}
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  void refetchVersion();
                  void refetchChallenge();
                }}
              >
                Thử lại
              </Button>
              <Button
                variant="secondary"
                onClick={() => router.push(`/tracks/${params.trackId}/lessons/${params.lessonId}`)}
              >
                Quay lại lesson
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const challengeRules = resolveChallengeRules(challengeVersion);
  const arenaLeader = rankedEntries[0] ?? null;
  const viewerEntry = viewerId ? rankedEntries.find((entry) => entry.userId === viewerId) ?? null : null;
  const challengeState = resolveChallengeState({ bestAttempt, latestAttempt, resumableSession });
  const latestFeedback =
    latestAttempt?.evaluation?.feedbackText ??
    (latestAttempt?.status === 'passed'
      ? 'Run mới nhất đã vượt qua toàn bộ điều kiện của challenge.'
      : latestAttempt?.status === 'failed'
        ? 'Run mới nhất vẫn chưa pass hết điều kiện.'
        : null);

  const progressProbe = bestAttempt?.evaluation ?? latestAttempt?.evaluation ?? null;
  const passConditions = [
    {
      key: 'correctness',
      title: 'Kết quả đúng',
      description: 'Validator phải xác nhận result-set đúng với output chuẩn của challenge.',
      statusLabel:
        bestAttempt || progressProbe?.isCorrect
          ? 'Đã đúng output'
          : 'Chưa có run đúng',
      tone: (bestAttempt || progressProbe?.isCorrect ? 'success' : latestAttempt ? 'warning' : 'default') as SignalTone,
      icon: bestAttempt || progressProbe?.isCorrect ? 'check_circle' : latestAttempt ? 'priority_high' : 'radio_button_unchecked',
      satisfied: Boolean(bestAttempt || progressProbe?.isCorrect),
    },
    challengeRules.baselineDurationMs != null
      ? {
          key: 'speed',
          title: 'Mốc hiệu năng',
          description: `Run pass phải nhanh hơn hoặc bằng ${formatDurationMetric(challengeRules.baselineDurationMs)}.`,
          statusLabel: progressProbe?.meetsPerformanceTarget
            ? 'Đạt mốc runtime'
            : latestAttempt
              ? 'Cần tối ưu thêm'
              : 'Chưa có benchmark',
          tone: (progressProbe?.meetsPerformanceTarget ? 'success' : latestAttempt ? 'warning' : 'default') as SignalTone,
          icon: progressProbe?.meetsPerformanceTarget ? 'bolt' : latestAttempt ? 'timer' : 'schedule',
          satisfied: Boolean(progressProbe?.meetsPerformanceTarget),
        }
      : null,
    challengeRules.requiresIndexOptimization
      ? {
          key: 'index',
          title: 'Index evidence',
          description: 'Session history và execution plan phải cùng xác nhận run thắng dùng đúng chiến lược index.',
          statusLabel: progressProbe?.usedIndexing ? 'Đã xác nhận' : latestAttempt ? 'Chưa có bằng chứng' : 'Chưa kiểm chứng',
          tone: (progressProbe?.usedIndexing ? 'success' : latestAttempt ? 'warning' : 'default') as SignalTone,
          icon: progressProbe?.usedIndexing ? 'dataset_linked' : latestAttempt ? 'schema' : 'data_object',
          satisfied: Boolean(progressProbe?.usedIndexing),
        }
      : null,
    {
      key: 'reward',
      title: 'Unlock reward',
      description: `Challenge chỉ mở toàn bộ ${challengeRules.rewardPoints} điểm khi tất cả điều kiện phía trên đều pass.`,
      statusLabel: bestAttempt || progressProbe?.passesChallenge
        ? `${challengeRules.rewardPoints} pts đã mở`
        : 'Reward locked',
      tone: (bestAttempt || progressProbe?.passesChallenge ? 'success' : latestAttempt ? 'warning' : 'default') as SignalTone,
      icon: bestAttempt || progressProbe?.passesChallenge ? 'workspace_premium' : latestAttempt ? 'lock_open_right' : 'lock',
      satisfied: Boolean(bestAttempt || progressProbe?.passesChallenge),
    },
  ].filter(
    (
      item,
    ): item is {
      key: string;
      title: string;
      description: string;
      statusLabel: string;
      tone: SignalTone;
      icon: string;
      satisfied: boolean;
    } => item !== null,
  );

  const completedConditions = passConditions.filter((item) => item.satisfied).length;
  const progressPercent = passConditions.length ? (completedConditions / passConditions.length) * 100 : 0;
  const gapToLeader =
    bestAttempt?.queryExecution.durationMs != null && arenaLeader?.bestDurationMs != null
      ? bestAttempt.queryExecution.durationMs - arenaLeader.bestDurationMs
      : null;

  const gapLabel =
    gapToLeader == null
      ? 'Chưa có benchmark cá nhân để so pace.'
      : gapToLeader <= 0
        ? 'Bạn đang bằng hoặc nhanh hơn top pace hiện tại.'
        : `Bạn còn chậm hơn top pace ${formatDurationMetric(gapToLeader)}.`;

  const sessionNote = resumableSession
    ? `Lab gần nhất hoạt động ${formatRelativeTime(
        resumableSession.lastActivityAt ?? resumableSession.startedAt,
      )}.`
    : 'Khi mở Challenge Lab, editor sẽ nhận starter query từ lesson hiện tại.';

  return (
    <div className="page-shell-wide page-stack">
      <Link
        href={`/tracks/${params.trackId}/lessons/${params.lessonId}`}
        className="inline-flex w-fit items-center gap-2 text-sm text-on-surface-variant transition-colors hover:text-on-surface"
      >
        <span className="material-symbols-outlined text-base">arrow_back</span>
        Quay lại lesson
      </Link>

      <Card className="relative overflow-hidden rounded-[2rem] border border-outline-variant/10 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.10),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.04),transparent_55%),linear-gradient(180deg,rgba(255,255,255,0.02),rgba(255,255,255,0.01))]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-secondary/45 to-transparent" />
        <div className="pointer-events-none absolute right-0 top-0 h-48 w-48 rounded-full bg-secondary/10 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-40 w-40 rounded-full bg-surface-container-highest/60 blur-3xl" />

        <CardContent className="relative px-6 py-6 sm:px-8 sm:py-8">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_22rem]">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="published">Challenge mission</Badge>
                <DifficultyBadge difficulty={challengeSummary.difficulty} />
                <Badge variant="default">{challengeVersion.validatorType.replace('_', ' ')}</Badge>
                <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant">
                  Based on {formatMinutes(lessonVersion.lesson?.estimatedMinutes ?? lesson.estimatedMinutes)}
                </span>
                {bestAttempt ? <Badge variant="success">Reward unlocked</Badge> : null}
                {resumableSession ? <StatusBadge status={resumableSession.status} /> : null}
              </div>

              <div className="mt-4 max-w-4xl">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
                  Tactical challenge board
                </p>
                <h1 className="mt-2 font-headline text-4xl font-bold tracking-tight text-on-surface sm:text-5xl">
                  {challengeSummary.title}
                </h1>
                <p className="mt-4 max-w-3xl text-[15px] leading-7 text-on-surface-variant">
                  {challengeSummary.description}
                </p>
                <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-on-surface-variant">
                  <span className="inline-flex items-center gap-2 rounded-full bg-surface-container-high px-3 py-1.5">
                    <span className="material-symbols-outlined text-base">menu_book</span>
                    Lesson: {lessonVersion.lesson?.title ?? lesson.title}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-surface-container-high px-3 py-1.5">
                    <span className="material-symbols-outlined text-base">emoji_events</span>
                    Rank theo runtime trước, rồi tới plan cost
                  </span>
                </div>
              </div>

              <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <MissionStatCard
                  label="Điểm thưởng"
                  value={`${challengeRules.rewardPoints} pts`}
                  supporting="Mở toàn bộ khi run pass đầy đủ điều kiện."
                  accent={bestAttempt ? 'success' : 'default'}
                />
                <MissionStatCard
                  label="Best pass"
                  value={formatDurationMetric(bestAttempt?.queryExecution.durationMs)}
                  supporting={
                    bestAttempt
                      ? `cost ${formatCostMetric(bestAttempt.queryExecution.totalCost)} • attempt #${bestAttempt.attemptNo}`
                      : 'Pass challenge để tạo benchmark cá nhân đầu tiên.'
                  }
                  accent={bestAttempt ? 'success' : 'default'}
                />
                <MissionStatCard
                  label="Top pace"
                  value={formatDurationMetric(arenaLeader?.bestDurationMs)}
                  supporting={
                    arenaLeader
                      ? `#${arenaLeader.rank} ${arenaLeader.displayName} • cost ${formatCostMetric(arenaLeader.bestTotalCost)}`
                      : 'Chưa có run ranked. Người pass đầu tiên sẽ mở pace board.'
                  }
                  accent={arenaLeader ? 'warning' : 'default'}
                />
                <MissionStatCard
                  label="Submissions"
                  value={`${sortedAttempts.length}`}
                  supporting={
                    latestAttempt
                      ? `Run gần nhất ${formatRelativeTime(latestAttempt.submittedAt)}`
                      : 'Challenge này đang chờ submission đầu tiên của bạn.'
                  }
                />
              </div>

              <div className="mt-6 grid gap-3 xl:grid-cols-4">
                <MissionLoopItem
                  step="01"
                  title="Mở lab"
                  description="Khởi tạo sandbox riêng cho challenge để bắt đầu từ starter query của lesson."
                />
                <MissionLoopItem
                  step="02"
                  title="Lấy output đúng"
                  description="Khóa đúng result-set trước khi dành thời gian tune performance."
                />
                <MissionLoopItem
                  step="03"
                  title="Tối ưu runtime"
                  description="So sánh query plan, điều chỉnh chiến lược index và quan sát cost thực tế."
                />
                <MissionLoopItem
                  step="04"
                  title="Submit run tốt nhất"
                  description="Khi đã ổn định, submit run nhanh nhất để leo lên board xếp hạng."
                />
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-outline-variant/10 bg-surface/80 p-5 backdrop-blur-glass">
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl',
                    challengeState.tone === 'success'
                      ? 'bg-secondary/15 text-secondary'
                      : challengeState.tone === 'warning'
                        ? 'bg-tertiary/15 text-tertiary'
                        : 'bg-surface-container-high text-on-surface-variant',
                  )}
                >
                  <span className="material-symbols-outlined text-[22px]">{challengeState.icon}</span>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
                    Trạng thái hiện tại
                  </p>
                  <h2 className="mt-2 font-headline text-2xl font-semibold tracking-tight text-on-surface">
                    {challengeState.label}
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-on-surface-variant">{challengeState.description}</p>
                </div>
              </div>

              <div className="mt-4 rounded-[1.25rem] border border-outline-variant/10 bg-surface-container-low/70 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <AttemptStatusBadge status={latestAttempt?.status ?? 'pending'} />
                  <span className="text-xs text-on-surface-variant">
                    {latestAttempt
                      ? `Attempt #${latestAttempt.attemptNo} • ${formatRelativeTime(latestAttempt.submittedAt)}`
                      : 'Chưa có run nào được submit'}
                  </span>
                </div>
                {latestFeedback ? (
                  <p className="mt-3 text-sm leading-6 text-on-surface-variant">{latestFeedback}</p>
                ) : (
                  <p className="mt-3 text-sm leading-6 text-on-surface-variant">
                    Khi bạn submit từ lab, feedback của validator sẽ hiện ở đây ngay.
                  </p>
                )}
                <AttemptEvaluationSummary evaluation={latestAttempt?.evaluation} />
              </div>

              <div className="mt-5 flex flex-col gap-2">
                {resumableSession ? (
                  <>
                    <Button
                      variant="primary"
                      size="lg"
                      onClick={handleContinueChallengeLab}
                      leftIcon={<span className="material-symbols-outlined text-lg">play_circle</span>}
                    >
                      Tiếp tục Challenge Lab
                    </Button>
                    <Button
                      variant="secondary"
                      size="lg"
                      loading={starting}
                      onClick={handleStartChallengeLab}
                      leftIcon={<span className="material-symbols-outlined text-lg">add_circle</span>}
                    >
                      Mở lab mới
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="primary"
                    size="lg"
                    loading={starting}
                    onClick={handleStartChallengeLab}
                    leftIcon={<span className="material-symbols-outlined text-lg">flag</span>}
                  >
                    Bắt đầu Challenge Lab
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  onClick={() => router.push(`/tracks/${params.trackId}/lessons/${params.lessonId}`)}
                >
                  Quay lại lesson
                </Button>
              </div>

              <div className="mt-5 rounded-[1.25rem] border border-outline-variant/10 bg-surface-container-low/70 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
                  Session note
                </p>
                <p className="mt-2 text-sm leading-6 text-on-surface-variant">{sessionNote}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(20rem,0.95fr)]">
        <div className="space-y-6">
          <Card className="rounded-[1.75rem] border border-outline-variant/10">
            <CardHeader>
              <div>
                <CardTitle>Brief đề bài</CardTitle>
                <CardDescription className="mt-1">
                  Đây là phần brief để bạn giữ đúng output trước khi đi vào tối ưu tốc độ và cost.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-[1.35rem] border border-outline-variant/10 bg-surface-container-low/70 px-4 py-4 text-sm leading-7 text-on-surface whitespace-pre-wrap">
                {challengeVersion.problemStatement}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-[1.25rem] border border-outline-variant/10 bg-surface-container-low/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
                    Hint
                  </p>
                  <p className="mt-2 text-sm leading-6 text-on-surface-variant whitespace-pre-wrap">
                    {challengeVersion.hintText ?? 'Challenge này không bật hint. Bạn cần tự suy luận từ brief và schema.'}
                  </p>
                </div>

                <div className="rounded-[1.25rem] border border-outline-variant/10 bg-surface-container-low/70 p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
                    Validator
                  </p>
                  <p className="mt-2 text-sm font-semibold text-on-surface">
                    {challengeVersion.validatorType.replace('_', ' ')}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                    Output của bạn sẽ được chấm tự động ngay sau khi submit execution thành công từ lab.
                  </p>
                </div>
              </div>

              <div className="rounded-[1.25rem] border border-outline-variant/10 bg-surface-container-low/70 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
                  Expected result columns
                </p>
                {challengeVersion.expectedResultColumns.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {challengeVersion.expectedResultColumns.map((column) => (
                      <code key={column} className="rounded-full bg-surface px-3 py-1.5 text-xs text-on-surface">
                        {column}
                      </code>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                    Challenge này không khóa trước danh sách cột ở UI.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[1.75rem] border border-outline-variant/10">
            <CardHeader>
              <div>
                <CardTitle>Checklist pass</CardTitle>
                <CardDescription className="mt-1">
                  Theo dõi xem run hiện tại của bạn đã đáp ứng tới đâu trước khi leo bảng.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-[1.35rem] border border-outline-variant/10 bg-surface-container-low/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
                      Challenge progress
                    </p>
                    <p className="mt-2 text-lg font-semibold text-on-surface">
                      {completedConditions}/{passConditions.length} điều kiện đã đạt
                    </p>
                  </div>
                  <span className="rounded-full bg-surface px-3 py-1.5 text-xs font-medium text-on-surface-variant">
                    {Math.round(progressPercent)}%
                  </span>
                </div>
                <div className="mt-4 h-2 rounded-full bg-surface">
                  <div
                    className="h-full rounded-full bg-secondary transition-all duration-300"
                    style={{ width: `${Math.max(8, progressPercent)}%` }}
                  />
                </div>
              </div>

              <div className="space-y-3">
                {passConditions.map((condition) => (
                  <ConditionRow
                    key={condition.key}
                    title={condition.title}
                    description={condition.description}
                    statusLabel={condition.statusLabel}
                    tone={condition.tone}
                    icon={condition.icon}
                  />
                ))}
              </div>

              <div className="rounded-[1.25rem] border border-outline-variant/10 bg-surface-container-low/70 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
                  Ranking rule
                </p>
                <p className="mt-2 text-lg font-semibold text-on-surface">Lower time, then lower cost</p>
                <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                  Sau khi pass, challenge sẽ xếp hạng theo runtime thấp hơn trước. Nếu runtime bằng nhau,
                  plan cost thấp hơn sẽ thắng. Vì vậy hãy khóa đúng output trước, rồi mới tối ưu.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="rounded-[1.75rem] border border-outline-variant/10">
            <CardHeader>
              <div>
                <CardTitle>Bảng điều khiển cá nhân</CardTitle>
                <CardDescription className="mt-1">
                  So run gần nhất, benchmark tốt nhất và khoảng cách tới top pace ngay trên một panel.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <PersonalSignalRow
                label="Latest submission"
                value={
                  latestAttempt
                    ? latestAttempt.status === 'passed'
                      ? 'Passed'
                      : latestAttempt.status === 'failed'
                        ? 'Not passed'
                        : latestAttempt.status
                    : 'No run yet'
                }
                supporting={
                  latestAttempt
                    ? `Attempt #${latestAttempt.attemptNo} • ${formatRelativeTime(latestAttempt.submittedAt)}`
                    : 'Mở Challenge Lab rồi submit một execution thành công để bắt đầu tracking.'
                }
              />
              <PersonalSignalRow
                label="Best validated run"
                value={formatDurationMetric(bestAttempt?.queryExecution.durationMs)}
                supporting={
                  bestAttempt
                    ? `cost ${formatCostMetric(bestAttempt.queryExecution.totalCost)} • reward unlocked`
                    : 'Chưa có run pass nào để làm benchmark cá nhân.'
                }
              />
              <PersonalSignalRow
                label="Khoảng cách tới top pace"
                value={gapToLeader == null ? '—' : gapToLeader <= 0 ? 'On pace' : formatDurationMetric(gapToLeader)}
                supporting={gapLabel}
              />
              <PersonalSignalRow
                label="Xếp hạng của bạn"
                value={viewerEntry ? `#${viewerEntry.rank}` : 'Chưa vào board'}
                supporting={
                  viewerEntry
                    ? `${viewerEntry.passedAttempts} run pass • ${viewerEntry.attemptsCount} attempts`
                    : 'Khi bạn có run pass đủ nhanh, entry của bạn sẽ xuất hiện trong pace board.'
                }
              />
            </CardContent>
          </Card>

          <Card className="rounded-[1.75rem] border border-outline-variant/10">
            <CardHeader>
              <div>
                <CardTitle>Top users</CardTitle>
                <CardDescription className="mt-1">
                  Pace board chỉ hiển thị các run đã pass đầy đủ điều kiện và được rank theo runtime trước.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {rankedEntries.length ? (
                rankedEntries.map((entry) => (
                  <LeaderboardCard
                    key={entry.userId}
                    entry={entry}
                    highlight={Boolean(viewerId && entry.userId === viewerId)}
                  />
                ))
              ) : (
                <div className="rounded-[1.25rem] border border-dashed border-outline-variant/20 bg-surface-container-low/70 px-4 py-6 text-sm text-on-surface-variant">
                  Chưa có leaderboard entry nào. Người pass đầu tiên sẽ mở pace board của challenge này.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="rounded-[1.75rem] border border-outline-variant/10">
        <CardHeader>
          <div>
            <CardTitle>Timeline submissions</CardTitle>
            <CardDescription className="mt-1">
              Newest runs first, gom toàn bộ attempts của bạn trên challenge version hiện tại.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {sortedAttempts.length ? (
            sortedAttempts.map((attempt) => (
              <AttemptTimelineItem
                key={attempt.id}
                attempt={attempt}
                rewardPoints={challengeRules.rewardPoints}
              />
            ))
          ) : (
            <div className="rounded-[1.25rem] border border-dashed border-outline-variant/20 bg-surface-container-low/70 px-4 py-6 text-sm text-on-surface-variant">
              Chưa có submission nào. Mở Challenge Lab, chạy query rồi submit execution mới nhất để tạo history.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
