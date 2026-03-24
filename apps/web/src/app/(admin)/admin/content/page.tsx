'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { DifficultyBadge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { challengesApi, tracksApi } from '@/lib/api';
import { cn } from '@/lib/utils';

type ContentTab = 'tracks' | 'lessons' | 'challenges';

const TAB_LABELS: Record<ContentTab, string> = {
  tracks: 'Tracks',
  lessons: 'Lessons',
  challenges: 'Challenges',
};

export default function AdminContentPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<ContentTab>('tracks');

  const tracksQuery = useQuery({
    queryKey: ['tracks-admin'],
    queryFn: () => tracksApi.list({ limit: 50 }),
    staleTime: 60_000,
  });

  const reviewQueueQuery = useQuery({
    queryKey: ['challenge-review-queue'],
    queryFn: () => challengesApi.listReviewQueue(),
    staleTime: 30_000,
  });

  const publishMutation = useMutation({
    mutationFn: (versionId: string) => challengesApi.publishVersion(versionId),
    onSuccess: () => {
      toast.success('Challenge published');
      void queryClient.invalidateQueries({ queryKey: ['challenge-review-queue'] });
    },
  });

  const tracks = tracksQuery.data?.items ?? [];
  const reviewQueue = reviewQueueQuery.data ?? [];

  return (
    <div className="page-shell-wide page-stack">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="page-title">Content Management</h1>
          <p className="page-lead mt-1">
            Manage learning tracks, lesson inventory, and the challenge approval queue.
          </p>
        </div>

        {activeTab === 'challenges' ? (
          <Link href="/contributor">
            <Button variant="primary" size="sm">
              Open Contributor Drafts
            </Button>
          </Link>
        ) : (
          <Button
            variant="primary"
            size="sm"
            leftIcon={<span className="material-symbols-outlined text-sm">add</span>}
            onClick={() => toast.success('Content editor coming soon')}
          >
            {activeTab === 'tracks' ? 'New Track' : 'New Lesson'}
          </Button>
        )}
      </div>

      <div className="flex items-center gap-1 rounded-xl bg-surface-container-low p-1 w-fit">
        {(Object.keys(TAB_LABELS) as ContentTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'rounded-lg px-4 py-1.5 text-sm font-medium transition-all',
              activeTab === tab
                ? 'bg-surface-container-high text-on-surface'
                : 'text-on-surface-variant hover:text-on-surface',
            )}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {activeTab === 'tracks' && (
        <div className="space-y-3">
          {tracksQuery.isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((index) => (
                <div key={index} className="h-20 animate-pulse rounded-xl bg-surface-container-low" />
              ))}
            </div>
          ) : tracks.length === 0 ? (
            <div className="rounded-xl bg-surface-container-low p-10 text-center">
              <p className="text-sm font-medium text-on-surface">No tracks yet</p>
            </div>
          ) : (
            tracks.map((track) => (
              <div
                key={track.id}
                className="flex items-center gap-4 rounded-xl bg-surface-container-low px-5 py-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="mb-1 flex items-center gap-3">
                    <h3 className="text-sm font-semibold text-on-surface">{track.title}</h3>
                    <DifficultyBadge difficulty={track.difficulty} />
                    <StatusBadge status={track.isPublished ? 'published' : 'draft'} />
                  </div>
                  <div className="flex items-center gap-4 text-xs text-on-surface-variant">
                    <span>{track.lessonCount} lessons</span>
                    {track.createdAt && (
                      <span>Created {new Date(track.createdAt).toLocaleDateString()}</span>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {activeTab === 'lessons' && (
        <div className="rounded-xl bg-surface-container-low p-10 text-center">
          <p className="text-sm font-medium text-on-surface">Lesson management stays track-scoped.</p>
          <p className="mt-2 text-xs text-on-surface-variant">
            Use the track detail flow when you need to edit lesson ordering or publish a lesson version.
          </p>
        </div>
      )}

      {activeTab === 'challenges' && (
        <Card className="rounded-[28px] border border-outline-variant/10">
          <CardHeader className="flex-col items-start gap-2 px-6 py-5">
            <div>
              <CardTitle>Challenge Review Queue</CardTitle>
              <CardDescription className="mt-1">
                Review contributor drafts, verify scoring setup, and publish the approved version.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 px-6 pb-6 pt-0">
            {reviewQueueQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2].map((index) => (
                  <div key={index} className="h-24 animate-pulse rounded-2xl bg-surface-container-low" />
                ))}
              </div>
            ) : reviewQueue.length === 0 ? (
              <div className="rounded-2xl bg-surface-container-low p-6 text-sm text-on-surface-variant">
                No challenge drafts are waiting for admin review.
              </div>
            ) : (
              reviewQueue.map((challenge) => (
                <div
                  key={challenge.id}
                  className="rounded-2xl border border-outline-variant/10 bg-surface-container-low p-5"
                >
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-semibold text-on-surface">{challenge.title}</h3>
                        <DifficultyBadge difficulty={challenge.difficulty} />
                        <StatusBadge status={challenge.status} />
                        <span className="rounded-full bg-secondary/10 px-2 py-0.5 text-xs text-secondary">
                          {challenge.points} pts
                        </span>
                      </div>

                      <p className="text-sm leading-6 text-on-surface-variant">
                        {challenge.description}
                      </p>

                      <div className="grid gap-2 text-sm text-on-surface-variant sm:grid-cols-2">
                        <p>
                          <span className="text-on-surface">Track:</span> {challenge.trackTitle}
                        </p>
                        <p>
                          <span className="text-on-surface">Lesson:</span> {challenge.lessonTitle}
                        </p>
                        <p>
                          <span className="text-on-surface">Creator:</span>{' '}
                          {challenge.createdBy.displayName ?? challenge.createdBy.username ?? 'Unknown'}
                        </p>
                        <p>
                          <span className="text-on-surface">Latest Version:</span> v
                          {challenge.latestVersionNo ?? 1}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="secondary"
                        onClick={() =>
                          challenge.latestVersionId &&
                          publishMutation.mutate(challenge.latestVersionId)
                        }
                        loading={
                          publishMutation.isPending &&
                          publishMutation.variables === challenge.latestVersionId
                        }
                        disabled={!challenge.latestVersionId}
                      >
                        Publish v{challenge.latestVersionNo ?? 1}
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
