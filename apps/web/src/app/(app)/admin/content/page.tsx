'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tracksApi } from '@/lib/api';
import { DifficultyBadge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

type ContentTab = 'tracks' | 'lessons';

const MOCK_TRACKS = [
  { id: '1', title: 'SQL Fundamentals', difficulty: 'beginner', lessonCount: 12, isPublished: true, createdAt: '2024-01-10' },
  { id: '2', title: 'Window Functions', difficulty: 'intermediate', lessonCount: 15, isPublished: true, createdAt: '2024-02-01' },
  { id: '3', title: 'Query Optimization', difficulty: 'advanced', lessonCount: 14, isPublished: false, createdAt: '2024-03-15' },
  { id: '4', title: 'Stored Procedures', difficulty: 'advanced', lessonCount: 16, isPublished: false, createdAt: '2024-04-20' },
];

const MOCK_LESSONS = [
  { id: 'l1', trackTitle: 'SQL Fundamentals', title: 'Introduction to SQL', difficulty: 'beginner', estimatedMinutes: 20, isPublished: true, order: 1 },
  { id: 'l2', trackTitle: 'SQL Fundamentals', title: 'SELECT Basics', difficulty: 'beginner', estimatedMinutes: 30, isPublished: true, order: 2 },
  { id: 'l3', trackTitle: 'Window Functions', title: 'Understanding OVER()', difficulty: 'intermediate', estimatedMinutes: 45, isPublished: true, order: 1 },
  { id: 'l4', trackTitle: 'Query Optimization', title: 'Reading Execution Plans', difficulty: 'advanced', estimatedMinutes: 60, isPublished: false, order: 1 },
];

export default function AdminContentPage() {
  const [activeTab, setActiveTab] = useState<ContentTab>('tracks');

  const { data: tracks, isLoading } = useQuery({
    queryKey: ['tracks-admin'],
    queryFn: () => tracksApi.list({ limit: 50 }),
    staleTime: 60_000,
  });

  const displayTracks = tracks?.items ?? MOCK_TRACKS;

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-headline text-2xl font-bold text-on-surface">Content Management</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Manage learning tracks and lessons.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          leftIcon={<span className="material-symbols-outlined text-sm">add</span>}
          onClick={() => toast.success('Content editor coming soon')}
        >
          {activeTab === 'tracks' ? 'New Track' : 'New Lesson'}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 bg-surface-container-low rounded-xl p-1 w-fit">
        {(['tracks', 'lessons'] as ContentTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'px-4 py-1.5 rounded-lg text-sm font-medium capitalize transition-all',
              activeTab === tab
                ? 'bg-surface-container-high text-on-surface'
                : 'text-on-surface-variant hover:text-on-surface'
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tracks */}
      {activeTab === 'tracks' && (
        <div className="space-y-3">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 bg-surface-container-low rounded-xl animate-pulse" />
              ))}
            </div>
          ) : (
            displayTracks.map((track) => (
              <div
                key={track.id}
                className="bg-surface-container-low rounded-xl px-5 py-4 flex items-center gap-4"
              >
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-semibold text-on-surface text-sm">{track.title}</h3>
                    <DifficultyBadge difficulty={track.difficulty} />
                    <StatusBadge status={track.isPublished ? 'published' : 'draft'} />
                  </div>
                  <div className="flex items-center gap-4 text-xs text-on-surface-variant">
                    <span>{track.lessonCount} lessons</span>
                    {track.createdAt && <span>Created {new Date(track.createdAt).toLocaleDateString()}</span>}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="ghost" size="sm">
                    <span className="material-symbols-outlined text-sm">edit</span>
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => toast.success(`Track ${track.isPublished ? 'unpublished' : 'published'}`)}
                  >
                    {track.isPublished ? 'Unpublish' : 'Publish'}
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => toast.error('Delete confirmation required')}
                  >
                    <span className="material-symbols-outlined text-sm">delete</span>
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Lessons */}
      {activeTab === 'lessons' && (
        <div className="space-y-3">
          {MOCK_LESSONS.map((lesson) => (
            <div
              key={lesson.id}
              className="bg-surface-container-low rounded-xl px-5 py-4 flex items-center gap-4"
            >
              <div className="w-8 h-8 rounded-full bg-surface-container-high flex items-center justify-center text-xs font-mono font-medium text-on-surface-variant shrink-0">
                {lesson.order}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-semibold text-on-surface text-sm">{lesson.title}</h3>
                  <DifficultyBadge difficulty={lesson.difficulty} />
                  <StatusBadge status={lesson.isPublished ? 'published' : 'draft'} />
                </div>
                <div className="flex items-center gap-4 text-xs text-on-surface-variant">
                  <span className="text-tertiary">{lesson.trackTitle}</span>
                  <span>{lesson.estimatedMinutes} min</span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button variant="ghost" size="sm">
                  <span className="material-symbols-outlined text-sm">edit</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => toast.success(`Lesson ${lesson.isPublished ? 'unpublished' : 'published'}`)}
                >
                  {lesson.isPublished ? 'Unpublish' : 'Publish'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
