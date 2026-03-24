'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { tracksApi } from '@/lib/api';
import { DifficultyBadge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type DifficultyFilter = 'all' | 'beginner' | 'intermediate' | 'advanced';

const FILTER_TABS: { value: DifficultyFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
];

const PLACEHOLDER_TRACKS = [
  {
    id: 'placeholder-sql-fundamentals',
    title: 'SQL Fundamentals',
    slug: 'sql-fundamentals',
    description: 'Build intuition for SELECT, filtering, sorting, grouping, and the first steps of structured querying.',
    difficulty: 'beginner' as const,
    lessonCount: 8,
  },
  {
    id: 'placeholder-joins',
    title: 'Joins & Relationships',
    slug: 'joins-relationships',
    description: 'Learn how relational tables connect and how to write joins that stay readable under pressure.',
    difficulty: 'intermediate' as const,
    lessonCount: 6,
  },
  {
    id: 'placeholder-optimization',
    title: 'Query Optimization',
    slug: 'query-optimization',
    description: 'Move from correct SQL to efficient SQL by understanding plans, indexes, and execution costs.',
    difficulty: 'advanced' as const,
    lessonCount: 7,
  },
];

export default function TracksPage() {
  const [filter, setFilter] = useState<DifficultyFilter>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['tracks'],
    queryFn: () => tracksApi.list({ limit: 20 }),
    staleTime: 60_000,
  });

  const tracks = data?.items.length ? data.items : PLACEHOLDER_TRACKS;
  const filtered =
    filter === 'all' ? tracks : tracks.filter((track) => track.difficulty === filter);

  return (
    <div className="page-shell page-stack">
      <div className="mb-10">
        <h1 className="font-headline text-4xl font-bold tracking-tight text-on-surface mb-2">
          Learning Tracks
        </h1>
        <p className="max-w-2xl text-outline font-light">
          Browse structured SQL paths, open a lesson, read the guide in Markdown, then launch the practice lab with the lesson starter query.
        </p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-headline text-xl font-medium text-on-surface">Published tracks</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Filter locally by difficulty until server-side filtering lands.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-xl bg-surface-container-low p-1">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setFilter(tab.value)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium font-body transition-all duration-150',
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

      {isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[1, 2, 3, 4].map((row) => (
            <div key={row} className="h-48 animate-pulse rounded-2xl bg-surface-container-low" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-surface-container-low p-12 text-center">
          <span className="material-symbols-outlined text-3xl text-outline">library_books</span>
          <p className="mt-3 text-sm font-medium text-on-surface">No tracks found</p>
          <p className="mt-1 text-xs text-on-surface-variant">Try a different difficulty filter.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((track) => (
            <Link key={track.id} href={`/tracks/${track.id}`}>
              <article className="group flex h-full flex-col rounded-[1.5rem] border border-outline-variant/10 bg-[linear-gradient(135deg,rgba(255,255,255,0.03),transparent_60%),linear-gradient(180deg,rgba(255,255,255,0.015),rgba(255,255,255,0.01))] p-6 transition-all duration-200 hover:border-outline-variant/20 hover:bg-surface-container">
                <div className="mb-6 flex items-start justify-between gap-3">
                  <DifficultyBadge difficulty={track.difficulty} />
                  <span className="rounded-full bg-surface-container-high px-2.5 py-1 text-xs font-medium text-on-surface-variant">
                    {track.lessonCount} lessons
                  </span>
                </div>

                <div className="flex-1">
                  <h2 className="font-headline text-2xl font-bold tracking-tight text-on-surface transition-colors group-hover:text-primary">
                    {track.title}
                  </h2>
                  <p className="mt-3 text-sm leading-7 text-on-surface-variant">
                    {track.description}
                  </p>
                </div>

                <div className="mt-6 flex items-center justify-between gap-4">
                  <div className="text-xs text-on-surface-variant">
                    Lesson-first flow
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container-high px-3 py-1.5 text-xs font-medium text-on-surface transition-colors group-hover:bg-surface-container-highest">
                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                    Explore track
                  </span>
                </div>
              </article>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
