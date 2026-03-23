'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { tracksApi, sessionsApi } from '@/lib/api';
import { DifficultyBadge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';
import { useState } from 'react';

const STATUS_ICONS: Record<string, string> = {
  completed: 'check_circle',
  in_progress: 'radio_button_checked',
  available: 'radio_button_unchecked',
  locked: 'lock',
};

const STATUS_COLORS: Record<string, string> = {
  completed: 'text-secondary',
  in_progress: 'text-primary',
  available: 'text-on-surface-variant',
  locked: 'text-outline',
};

export default function TrackDetailPage() {
  const { trackId } = useParams<{ trackId: string }>();
  const router = useRouter();
  const [starting, setStarting] = useState<string | null>(null);

  const { data: track, isLoading: trackLoading } = useQuery({
    queryKey: ['track', trackId],
    queryFn: () => tracksApi.get(trackId),
    staleTime: 60_000,
  });

  const { data: lessons, isLoading: lessonsLoading } = useQuery({
    queryKey: ['track-lessons', trackId],
    queryFn: () => tracksApi.getLessons(trackId),
    staleTime: 60_000,
  });

  const isLoading = trackLoading || lessonsLoading;

  const handleStartLesson = async (lessonId: string, publishedVersionId: string | null | undefined) => {
    if (!publishedVersionId) {
      toast.error('This lesson is not available yet');
      return;
    }
    setStarting(lessonId);
    try {
      const session = await sessionsApi.create({ lessonVersionId: publishedVersionId });
      router.push(`/lab/${session.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start lesson';
      toast.error(msg);
      setStarting(null);
    }
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-6">
        <div className="h-32 bg-surface-container-low rounded-xl animate-pulse" />
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-16 bg-surface-container-low rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  // Fallback demo data
  const displayTrack = track ?? {
    id: trackId,
    title: 'SQL Fundamentals',
    description:
      'Learn the building blocks of SQL — SELECT, WHERE, ORDER BY, GROUP BY and aggregation functions. Perfect for absolute beginners.',
    difficulty: 'beginner' as const,
    lessonCount: 12,
    estimatedHours: 4,
    tags: ['SELECT', 'WHERE', 'JOIN', 'GROUP BY'],
    userProgress: { completedLessons: 3, lastAccessedAt: '' },
  };

  const displayLessons = lessons ?? [
    { id: 'l1', title: 'Introduction to SQL', estimatedMinutes: 20, difficulty: 'beginner' as const, status: 'completed' as const, sortOrder: 1, publishedVersionId: null },
    { id: 'l2', title: 'SELECT Basics', estimatedMinutes: 30, difficulty: 'beginner' as const, status: 'completed' as const, sortOrder: 2, publishedVersionId: null },
    { id: 'l3', title: 'Filtering with WHERE', estimatedMinutes: 35, difficulty: 'beginner' as const, status: 'completed' as const, sortOrder: 3, publishedVersionId: null },
    { id: 'l4', title: 'Sorting and Limiting', estimatedMinutes: 25, difficulty: 'beginner' as const, status: 'in_progress' as const, sortOrder: 4, publishedVersionId: null },
    { id: 'l5', title: 'Aggregate Functions', estimatedMinutes: 40, difficulty: 'beginner' as const, status: 'available' as const, sortOrder: 5, publishedVersionId: null },
    { id: 'l6', title: 'GROUP BY and HAVING', estimatedMinutes: 45, difficulty: 'intermediate' as const, status: 'locked' as const, sortOrder: 6, publishedVersionId: null },
    { id: 'l7', title: 'INNER JOIN', estimatedMinutes: 50, difficulty: 'intermediate' as const, status: 'locked' as const, sortOrder: 7, publishedVersionId: null },
    { id: 'l8', title: 'LEFT and RIGHT JOIN', estimatedMinutes: 50, difficulty: 'intermediate' as const, status: 'locked' as const, sortOrder: 8, publishedVersionId: null },
  ];

  const progress = displayTrack.userProgress
    ? Math.round((displayTrack.userProgress.completedLessons / displayTrack.lessonCount) * 100)
    : 0;

  const completedCount = displayLessons.filter((l) => l.status === 'completed').length;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Track header */}
      <div className="bg-surface-container-low rounded-xl p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-3">
              <DifficultyBadge difficulty={displayTrack.difficulty} />
              <span className="text-xs text-on-surface-variant">
                {displayTrack.lessonCount} lessons · ~{displayTrack.estimatedHours}h
              </span>
            </div>
            <h1 className="font-headline text-2xl font-bold text-on-surface mb-2">
              {displayTrack.title}
            </h1>
            <p className="text-sm text-on-surface-variant leading-relaxed max-w-2xl">
              {displayTrack.description}
            </p>

            {/* Tags */}
            {displayTrack.tags && displayTrack.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-4">
                {displayTrack.tags.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs font-mono bg-surface-container-high text-on-surface-variant px-2 py-0.5 rounded"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Progress ring (simplified) */}
          <div className="shrink-0 text-center">
            <div className="relative w-20 h-20">
              <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                <circle
                  cx="40"
                  cy="40"
                  r="32"
                  fill="none"
                  stroke="#2a2a2a"
                  strokeWidth="6"
                />
                <circle
                  cx="40"
                  cy="40"
                  r="32"
                  fill="none"
                  stroke="url(#progressGradient)"
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 32}`}
                  strokeDashoffset={`${2 * Math.PI * 32 * (1 - progress / 100)}`}
                  className="transition-all duration-700"
                />
                <defs>
                  <linearGradient id="progressGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#bac3ff" />
                    <stop offset="100%" stopColor="#4453a7" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="font-headline font-bold text-sm text-primary">{progress}%</span>
              </div>
            </div>
            <p className="text-xs text-on-surface-variant mt-1">
              {completedCount}/{displayTrack.lessonCount} done
            </p>
          </div>
        </div>
      </div>

      {/* Lesson list */}
      <div>
        <h2 className="font-headline text-lg font-semibold text-on-surface mb-3">Lessons</h2>
        <div className="space-y-2">
          {displayLessons.map((lesson, index) => {
            const status = lesson.status ?? 'available';
            const isLocked = status === 'locked';
            const isActive = status === 'in_progress';

            return (
              <div
                key={lesson.id}
                className={cn(
                  'bg-surface-container-low rounded-xl px-5 py-4 flex items-center gap-4 transition-colors',
                  isLocked
                    ? 'opacity-50'
                    : 'hover:bg-surface-container cursor-pointer'
                )}
              >
                {/* Order number */}
                <div className="w-7 h-7 rounded-full bg-surface-container-high flex items-center justify-center text-xs font-mono font-medium text-on-surface-variant shrink-0">
                  {index + 1}
                </div>

                {/* Status icon */}
                <span
                  className={cn(
                    'material-symbols-outlined text-xl shrink-0',
                    STATUS_COLORS[status] ?? 'text-on-surface-variant'
                  )}
                  style={{
                    fontVariationSettings: status === 'completed' ? "'FILL' 1" : "'FILL' 0",
                  }}
                >
                  {STATUS_ICONS[status] ?? 'radio_button_unchecked'}
                </span>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3
                      className={cn(
                        'text-sm font-medium truncate',
                        isActive ? 'text-primary' : 'text-on-surface'
                      )}
                    >
                      {lesson.title}
                    </h3>
                    {isActive && (
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full shrink-0">
                        In Progress
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-on-surface-variant">
                    <span className="flex items-center gap-1">
                      <span className="material-symbols-outlined text-xs">schedule</span>
                      {lesson.estimatedMinutes} min
                    </span>
                    <DifficultyBadge difficulty={lesson.difficulty} />
                  </div>
                </div>

                {/* Action */}
                {!isLocked && (
                  <Button
                    variant={isActive ? 'primary' : 'ghost'}
                    size="sm"
                    loading={starting === lesson.id}
                    onClick={() => handleStartLesson(lesson.id, lesson.publishedVersionId)}
                    leftIcon={
                      <span className="material-symbols-outlined text-sm">
                        {status === 'completed' ? 'replay' : 'play_arrow'}
                      </span>
                    }
                  >
                    {status === 'completed' ? 'Review' : isActive ? 'Continue' : 'Start'}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
