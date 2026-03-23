'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { tracksApi } from '@/lib/api';
import { DifficultyBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type DifficultyFilter = 'all' | 'beginner' | 'intermediate' | 'advanced';

const FILTER_TABS: { value: DifficultyFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

// Fallback data while API loads
const PLACEHOLDER_TRACKS = [
  {
    id: '1',
    title: 'SQL Fundamentals',
    slug: 'sql-fundamentals',
    description:
      'Learn the building blocks of SQL — SELECT, WHERE, ORDER BY, GROUP BY and aggregation functions. Perfect for absolute beginners.',
    difficulty: 'beginner' as const,
    lessonCount: 12,
    estimatedHours: 4,
    tags: ['SELECT', 'WHERE', 'JOIN', 'GROUP BY'],
    userProgress: { completedLessons: 8, lastAccessedAt: '' },
  },
  {
    id: '2',
    title: 'Joins & Relationships',
    slug: 'joins-relationships',
    description:
      'Deep dive into INNER, LEFT, RIGHT, and FULL OUTER JOINs. Understand relational data modeling and normalization.',
    difficulty: 'beginner' as const,
    lessonCount: 10,
    estimatedHours: 3,
    tags: ['JOIN', 'INNER', 'LEFT JOIN', 'OUTER JOIN'],
    userProgress: { completedLessons: 3, lastAccessedAt: '' },
  },
  {
    id: '3',
    title: 'Window Functions',
    slug: 'window-functions',
    description:
      'Master OVER(), PARTITION BY, RANK, ROW_NUMBER, LAG, LEAD and the full power of analytical SQL queries.',
    difficulty: 'intermediate' as const,
    lessonCount: 15,
    estimatedHours: 6,
    tags: ['OVER', 'PARTITION BY', 'RANK', 'LAG', 'LEAD'],
    userProgress: null,
  },
  {
    id: '4',
    title: 'CTEs & Subqueries',
    slug: 'ctes-subqueries',
    description:
      'Write cleaner, more maintainable SQL using Common Table Expressions (WITH) and correlated subqueries.',
    difficulty: 'intermediate' as const,
    lessonCount: 11,
    estimatedHours: 4,
    tags: ['CTE', 'WITH', 'Subquery', 'EXISTS'],
    userProgress: null,
  },
  {
    id: '5',
    title: 'Query Optimization',
    slug: 'query-optimization',
    description:
      'Understand execution plans, indexing strategies, query hints, and how the database optimizer thinks.',
    difficulty: 'advanced' as const,
    lessonCount: 14,
    estimatedHours: 8,
    tags: ['EXPLAIN', 'INDEX', 'Execution Plan', 'Optimizer'],
    userProgress: null,
  },
  {
    id: '6',
    title: 'Stored Procedures & Transactions',
    slug: 'stored-procedures',
    description:
      'Build robust database logic with stored procedures, functions, transactions (ACID), and error handling.',
    difficulty: 'advanced' as const,
    lessonCount: 16,
    estimatedHours: 9,
    tags: ['PROCEDURE', 'TRANSACTION', 'ACID', 'COMMIT'],
    userProgress: null,
  },
];

export default function TracksPage() {
  const [filter, setFilter] = useState<DifficultyFilter>('all');

  const { data: apiTracks, isLoading } = useQuery({
    queryKey: ['tracks', filter],
    queryFn: () =>
      tracksApi.list({
        difficulty: filter === 'all' ? undefined : filter,
        limit: 20,
      }),
    staleTime: 60_000,
  });

  // When using API data, it's already filtered by the difficulty param.
  // Client-side filter is only needed for the placeholder fallback.
  const tracks = apiTracks?.items ?? PLACEHOLDER_TRACKS;
  const filtered = apiTracks
    ? tracks
    : filter === 'all'
      ? tracks
      : tracks.filter((t) => t.difficulty === filter);

  return (
    <div className="p-8 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="mb-10">
        <h1 className="font-headline text-4xl font-bold tracking-tight text-on-surface mb-2">
          Learning Tracks
        </h1>
        <p className="text-outline font-light max-w-2xl">
          Structured paths to SQL mastery — from fundamentals to expert-level optimization.
          Compete against the engine and the community in precision-focused challenges.
        </p>
      </div>

      {/* Filters row */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="font-headline text-xl font-medium flex items-center gap-2">
          <span className="w-1.5 h-6 bg-tertiary rounded-full shrink-0" />
          Active Tracks
        </h2>
        <div className="flex items-center gap-1 bg-surface-container-low rounded-xl p-1">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium font-body transition-all duration-150',
                filter === tab.value
                  ? 'bg-surface-container-highest text-on-surface'
                  : 'text-on-surface-variant hover:text-on-surface'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Track list */}
      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 bg-surface-container-low rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-surface-container-low rounded-xl p-12 flex flex-col items-center text-center">
          <span className="material-symbols-outlined text-3xl text-outline mb-3">library_books</span>
          <p className="text-sm font-medium text-on-surface mb-1">No tracks found</p>
          <p className="text-xs text-on-surface-variant">Try a different difficulty filter.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map((track) => {
            const progress = track.userProgress
              ? Math.round((track.userProgress.completedLessons / track.lessonCount) * 100)
              : 0;
            const started = progress > 0;

            return (
              <Link key={track.id} href={`/tracks/${track.id}`}>
                <article className="bg-surface-container-low rounded-xl p-6 group hover:bg-surface-container-high transition-all duration-200 border-l-4 border-transparent hover:border-primary cursor-pointer">
                  <div className="flex justify-between items-start gap-6">
                    <div className="flex-1 min-w-0">
                      {/* Title row */}
                      <div className="flex items-center gap-3 mb-1.5">
                        <h2 className="font-headline text-lg font-bold text-on-surface group-hover:text-primary transition-colors">
                          {track.title}
                        </h2>
                        <DifficultyBadge difficulty={track.difficulty} />
                      </div>

                      {/* Description */}
                      <p className="text-sm text-outline leading-relaxed mb-4 line-clamp-2">
                        {track.description}
                      </p>

                      {/* Tags + meta */}
                      <div className="flex items-center gap-4 flex-wrap">
                        {track.tags?.slice(0, 4).map((tag) => (
                          <span
                            key={tag}
                            className="text-[10px] font-mono bg-surface-container-high text-on-surface-variant px-2 py-0.5 rounded uppercase tracking-wide"
                          >
                            {tag}
                          </span>
                        ))}
                        <span className="h-3 w-px bg-outline-variant/30 hidden sm:block" />
                        <span className="text-xs text-outline flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">menu_book</span>
                          {track.lessonCount} lessons
                        </span>
                        <span className="text-xs text-outline flex items-center gap-1">
                          <span className="material-symbols-outlined text-sm">schedule</span>
                          ~{track.estimatedHours}h
                        </span>
                      </div>
                    </div>

                    {/* Right: progress + CTA */}
                    <div className="shrink-0 flex flex-col items-end gap-3 min-w-[140px]">
                      {started ? (
                        <>
                          <div className="text-right">
                            <span className="text-xs text-on-surface-variant">
                              {track.userProgress!.completedLessons}/{track.lessonCount} done
                            </span>
                          </div>
                          <div className="w-32 h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-primary to-[#4453a7] rounded-full"
                              style={{ width: `${progress}%` }}
                            />
                          </div>
                          <Button variant="secondary" size="sm" leftIcon={<span className="material-symbols-outlined text-sm">play_arrow</span>}>
                            Continue
                          </Button>
                        </>
                      ) : (
                        <Button variant="ghost" size="sm" leftIcon={<span className="material-symbols-outlined text-sm">rocket_launch</span>}>
                          Start Track
                        </Button>
                      )}
                    </div>
                  </div>
                </article>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
