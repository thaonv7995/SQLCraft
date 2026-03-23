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

  const tracks = apiTracks?.items ?? PLACEHOLDER_TRACKS;
  const filtered =
    filter === 'all' ? tracks : tracks.filter((t) => t.difficulty === filter);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="font-headline text-2xl font-bold text-on-surface">Learning Tracks</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Structured paths to SQL mastery — from fundamentals to expert-level optimization.
        </p>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 bg-surface-container-low rounded-xl p-1 w-fit">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setFilter(tab.value)}
            className={cn(
              'px-4 py-1.5 rounded-lg text-sm font-medium font-body transition-all duration-150',
              filter === tab.value
                ? 'bg-surface-container-high text-on-surface'
                : 'text-on-surface-variant hover:text-on-surface'
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Count */}
      <p className="text-xs text-on-surface-variant">
        {isLoading ? 'Loading...' : `${filtered.length} track${filtered.length !== 1 ? 's' : ''}`}
      </p>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-64 bg-surface-container-low rounded-xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((track) => {
            const progress = track.userProgress
              ? Math.round((track.userProgress.completedLessons / track.lessonCount) * 100)
              : 0;
            const started = progress > 0;

            return (
              <Link key={track.id} href={`/tracks/${track.id}`}>
                <article className="bg-surface-container-low rounded-xl p-5 h-full flex flex-col hover:bg-surface-container transition-colors group cursor-pointer">
                  {/* Top meta */}
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <DifficultyBadge difficulty={track.difficulty} />
                    <div className="flex items-center gap-3 text-xs text-on-surface-variant">
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-sm">menu_book</span>
                        {track.lessonCount} lessons
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="material-symbols-outlined text-sm">schedule</span>
                        ~{track.estimatedHours}h
                      </span>
                    </div>
                  </div>

                  {/* Title & desc */}
                  <h2 className="font-headline text-base font-semibold text-on-surface group-hover:text-primary transition-colors mb-2">
                    {track.title}
                  </h2>
                  <p className="text-sm text-on-surface-variant line-clamp-3 mb-4 flex-1">
                    {track.description}
                  </p>

                  {/* Tags */}
                  {track.tags && (
                    <div className="flex flex-wrap gap-1.5 mb-4">
                      {track.tags.slice(0, 4).map((tag) => (
                        <span
                          key={tag}
                          className="text-xs font-mono bg-surface-container-high text-on-surface-variant px-2 py-0.5 rounded"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Progress bar */}
                  {started && (
                    <div className="mb-4">
                      <div className="flex justify-between text-xs text-on-surface-variant mb-1.5">
                        <span>Progress</span>
                        <span>
                          {track.userProgress!.completedLessons}/{track.lessonCount} lessons
                        </span>
                      </div>
                      <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-primary to-[#4453a7] rounded-full"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* CTA */}
                  <div className="mt-auto">
                    <Button
                      variant={started ? 'secondary' : 'primary'}
                      size="sm"
                      fullWidth
                      leftIcon={
                        <span className="material-symbols-outlined text-sm">
                          {started ? 'play_arrow' : 'rocket_launch'}
                        </span>
                      }
                    >
                      {started ? 'Continue' : 'Start Track'}
                    </Button>
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
