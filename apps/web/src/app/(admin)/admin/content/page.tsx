'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { tracksApi } from '@/lib/api';
import { DifficultyBadge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

type ContentTab = 'tracks' | 'lessons';


export default function AdminContentPage() {
  const [activeTab, setActiveTab] = useState<ContentTab>('tracks');

  const { data: tracks, isLoading } = useQuery({
    queryKey: ['tracks-admin'],
    queryFn: () => tracksApi.list({ limit: 50 }),
    staleTime: 60_000,
  });

  const displayTracks = tracks?.items ?? [];

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
          ) : displayTracks.length === 0 ? (
            <div className="bg-surface-container-low rounded-xl p-10 flex flex-col items-center justify-center text-center">
              <span className="material-symbols-outlined text-3xl text-outline mb-3">route</span>
              <p className="text-sm font-medium text-on-surface mb-1">No tracks yet</p>
              <p className="text-xs text-on-surface-variant">Create your first learning track to get started.</p>
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
        <div className="bg-surface-container-low rounded-xl p-10 flex flex-col items-center justify-center text-center">
          <span className="material-symbols-outlined text-3xl text-outline mb-3">menu_book</span>
          <p className="text-sm font-medium text-on-surface mb-1">Select a track to manage its lessons</p>
          <p className="text-xs text-on-surface-variant">
            Lesson management is available from the individual track view.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-4"
            onClick={() => setActiveTab('tracks')}
          >
            View Tracks
          </Button>
        </div>
      )}
    </div>
  );
}
