'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { DifficultyBadge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Select, Textarea } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  challengesApi,
  databasesApi,
  type AdminChallengeCatalogItem,
  type ChallengeReviewItem,
  type DatabaseDomain,
} from '@/lib/api';
import { DATABASE_DOMAIN_LABELS, DATABASE_DOMAIN_OPTIONS } from '@/lib/database-catalog';
import { cn, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';

const emptyReview: ChallengeReviewItem[] = [];

const CATALOG_STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
] as const;

const CATALOG_PAGE_SIZE_OPTIONS = [
  { value: '10', label: '10 / page' },
  { value: '20', label: '20 / page' },
  { value: '50', label: '50 / page' },
];

function CatalogCardSkeleton() {
  return (
    <div className="rounded-xl border border-transparent bg-surface-container-low p-6">
      <div className="mb-4 flex items-start justify-between">
        <div className="h-12 w-12 rounded-lg bg-surface-container-high animate-pulse" />
        <div className="h-6 w-20 rounded bg-surface-container-high animate-pulse" />
      </div>
      <div className="mb-2 h-4 w-3/4 rounded bg-surface-container-high animate-pulse" />
      <div className="mb-4 space-y-2">
        <div className="h-3 w-full rounded bg-surface-container-high animate-pulse" />
        <div className="h-3 w-5/6 rounded bg-surface-container-high animate-pulse" />
      </div>
      <div className="grid grid-cols-2 gap-4 border-t border-outline-variant/10 pt-4">
        <div className="h-8 rounded bg-surface-container-high animate-pulse" />
        <div className="h-8 rounded bg-surface-container-high animate-pulse" />
      </div>
    </div>
  );
}

export default function AdminContentChallengesPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const databasesQuery = useQuery({
    queryKey: ['admin-content-databases'],
    queryFn: () => databasesApi.list({ limit: 200, page: 1 }),
  });

  const reviewQuery = useQuery({
    queryKey: ['admin-challenge-review'],
    queryFn: challengesApi.listReviewQueue,
  });

  const [reviewQueueOpen, setReviewQueueOpen] = useState(false);

  const [catalogDomain, setCatalogDomain] = useState<string>('all');
  const [catalogDatabaseId, setCatalogDatabaseId] = useState('');
  const [catalogStatus, setCatalogStatus] = useState<
    'all' | 'draft' | 'published' | 'archived'
  >('all');
  const [catalogPage, setCatalogPage] = useState(1);
  const [catalogLimit, setCatalogLimit] = useState(20);

  const catalogDatabaseSelectOptions = useMemo(() => {
    const items = databasesQuery.data?.items ?? [];
    return items
      .filter((d) => catalogDomain === 'all' || d.domain === catalogDomain)
      .map((d) => ({
        value: d.schemaTemplateId ?? d.id,
        label: d.name,
      }));
  }, [databasesQuery.data?.items, catalogDomain]);

  useEffect(() => {
    if (!catalogDatabaseId) return;
    const ok = catalogDatabaseSelectOptions.some((o) => o.value === catalogDatabaseId);
    if (!ok) setCatalogDatabaseId('');
  }, [catalogDatabaseSelectOptions, catalogDatabaseId]);

  useEffect(() => {
    setCatalogPage(1);
  }, [catalogDomain, catalogDatabaseId, catalogStatus, catalogLimit]);

  useEffect(() => {
    if (!reviewQueueOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setReviewQueueOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [reviewQueueOpen]);

  const catalogQuery = useQuery({
    queryKey: [
      'admin-challenges-catalog',
      catalogPage,
      catalogLimit,
      catalogDomain,
      catalogDatabaseId,
      catalogStatus,
    ],
    queryFn: () =>
      challengesApi.listAdminCatalog({
        page: catalogPage,
        limit: catalogLimit,
        domain:
          catalogDomain === 'all' ? undefined : (catalogDomain as DatabaseDomain),
        databaseId: catalogDatabaseId || undefined,
        status: catalogStatus,
      }),
  });

  const [decisionModal, setDecisionModal] = useState<
    | { open: false }
    | {
        open: true;
        versionId: string;
        challengeTitle: string;
        decision: 'request_changes' | 'reject';
      }
  >({ open: false });
  const [reviewNote, setReviewNote] = useState('');

  const publishMutation = useMutation({
    mutationFn: (versionId: string) => challengesApi.publishVersion(versionId),
    onSuccess: () => {
      toast.success('Challenge published');
      queryClient.invalidateQueries({ queryKey: ['admin-challenge-review'] });
      queryClient.invalidateQueries({ queryKey: ['challenges-published'] });
      queryClient.invalidateQueries({ queryKey: ['admin-challenges-catalog'] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const reviewMutation = useMutation({
    mutationFn: (args: { versionId: string; decision: 'request_changes' | 'reject'; note?: string }) =>
      challengesApi.reviewVersion(args.versionId, {
        decision: args.decision === 'request_changes' ? 'request_changes' : 'reject',
        note: args.note,
      }),
    onSuccess: () => {
      toast.success('Review saved');
      queryClient.invalidateQueries({ queryKey: ['admin-challenge-review'] });
      queryClient.invalidateQueries({ queryKey: ['admin-challenges-catalog'] });
      setDecisionModal({ open: false });
      setReviewNote('');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const openCatalogChallenge = (row: AdminChallengeCatalogItem) => {
    if (row.status === 'published') {
      router.push(`/challenges/${row.slug}`);
    }
  };

  const reviewRows = reviewQuery.data ?? emptyReview;
  const reviewPendingCount = reviewRows.length;
  const catalog = catalogQuery.data;
  const catalogRows = catalog?.items ?? [];
  const catalogTotal = catalog?.total ?? 0;
  const catalogTotalPages = Math.max(1, catalog?.totalPages ?? 1);

  return (
    <div className="page-shell-wide page-stack pb-10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <h1 className="page-title-lg">Challenges</h1>
          <p className="mt-2 max-w-3xl text-sm text-on-surface-variant">
            Browse the catalog as learners see it. Add drafts on a separate screen; open the review
            queue when contributors submit versions for approval.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" onClick={() => router.push('/admin/content/new')}>
            Add new challenge
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setReviewQueueOpen(true)}
            leftIcon={
              <span className="material-symbols-outlined text-base" aria-hidden>
                rate_review
              </span>
            }
          >
            Review queue
            {reviewPendingCount > 0 ? (
              <span className="ml-1.5 rounded-full bg-primary/20 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-on-surface">
                {reviewPendingCount}
              </span>
            ) : null}
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="space-y-6">
          <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low/40 p-4 sm:p-6">
            <div className="mb-4">
              <h2 className="font-headline text-base font-semibold text-on-surface">All challenges</h2>
              <p className="mt-1 text-xs text-on-surface-variant">
                Filter by domain, database, and status — same card layout as the learner catalog.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Select
                label="Domain"
                value={catalogDomain}
                onChange={(e) => setCatalogDomain(e.target.value)}
                options={DATABASE_DOMAIN_OPTIONS}
              />
              <Select
                label="Database"
                value={catalogDatabaseId}
                onChange={(e) => setCatalogDatabaseId(e.target.value)}
                options={[
                  {
                    value: '',
                    label: databasesQuery.isLoading ? 'Loading…' : 'All databases',
                  },
                  ...catalogDatabaseSelectOptions,
                ]}
              />
              <Select
                label="Status"
                value={catalogStatus}
                onChange={(e) =>
                  setCatalogStatus(e.target.value as 'all' | 'draft' | 'published' | 'archived')
                }
                options={[...CATALOG_STATUS_OPTIONS]}
              />
              <Select
                label="Page size"
                value={String(catalogLimit)}
                onChange={(e) => setCatalogLimit(Number(e.target.value) || 20)}
                options={CATALOG_PAGE_SIZE_OPTIONS}
              />
            </div>

            {catalogQuery.isLoading ? (
              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <CatalogCardSkeleton key={i} />
                ))}
              </div>
            ) : catalogQuery.isError ? (
              <div className="mt-6 rounded-xl bg-surface-container-low p-12 text-center">
                <span className="material-symbols-outlined mb-2 block text-3xl text-outline">
                  error
                </span>
                <p className="text-sm text-error">Could not load challenge catalog.</p>
              </div>
            ) : catalogRows.length === 0 ? (
              <div className="mt-6 rounded-xl bg-surface-container-low p-12 text-center">
                <span className="material-symbols-outlined mb-2 block text-3xl text-outline">
                  search_off
                </span>
                <p className="text-sm font-medium text-on-surface">No challenges match these filters</p>
                <p className="mt-1 text-xs text-on-surface-variant">Try widening domain or status.</p>
              </div>
            ) : (
              <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {catalogRows.map((row) => {
                  const clickable = row.status === 'published';
                  return (
                    <div
                      key={row.id}
                      role={clickable ? 'button' : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onClick={() => clickable && openCatalogChallenge(row)}
                      onKeyDown={(e) => {
                        if (!clickable) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openCatalogChallenge(row);
                        }
                      }}
                      aria-label={clickable ? `Open ${row.title}` : undefined}
                      className={cn(
                        'group relative overflow-hidden rounded-xl border border-transparent bg-surface-container-low p-6 transition-all duration-200',
                        clickable &&
                          'cursor-pointer hover:border-outline-variant/20 hover:bg-surface-container focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                        !clickable && 'border-outline-variant/10',
                      )}
                    >
                      <div className="mb-4 flex items-start justify-between gap-2">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-surface-container-highest">
                          <span
                            className="material-symbols-outlined text-2xl text-tertiary"
                            style={{ fontVariationSettings: "'FILL' 1" }}
                            aria-hidden
                          >
                            quiz
                          </span>
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <StatusBadge status={row.status} className="capitalize" />
                          <DifficultyBadge difficulty={row.difficulty} className="capitalize" />
                        </div>
                      </div>

                      <h3
                        className={cn(
                          'font-headline mb-1.5 text-base font-bold text-on-surface',
                          clickable && 'group-hover:text-primary transition-colors',
                        )}
                      >
                        {row.title}
                      </h3>
                      <p className="mb-2 font-mono text-[11px] text-on-surface-variant">{row.slug}</p>
                      <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-outline">
                        {row.description?.trim() ? row.description : '—'}
                      </p>
                      <p className="mb-4 text-[10px] text-on-surface-variant">
                        {DATABASE_DOMAIN_LABELS[row.catalogDomain] ?? row.catalogDomain}
                        <span className="mx-1.5 text-outline">·</span>
                        {formatDate(row.updatedAt)}
                      </p>

                      <div className="grid grid-cols-2 gap-4 border-t border-outline-variant/10 pt-4">
                        <div>
                          <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-outline">
                            Points
                          </p>
                          <p className="font-mono text-sm font-bold text-on-surface">{row.points} pts</p>
                        </div>
                        <div>
                          <p className="mb-1 text-[9px] font-bold uppercase tracking-widest text-outline">
                            Database
                          </p>
                          <p className="line-clamp-1 font-mono text-sm font-bold text-tertiary">
                            {row.databaseName ?? '—'}
                          </p>
                        </div>
                      </div>

                      <div
                        className="mt-4 flex flex-wrap gap-2 border-t border-outline-variant/10 pt-4"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e: ReactKeyboardEvent) => e.stopPropagation()}
                      >
                        {row.status === 'published' ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            type="button"
                            onClick={() => router.push(`/challenges/${row.slug}`)}
                          >
                            View live
                          </Button>
                        ) : null}
                        {row.latestVersionId &&
                        row.status === 'draft' &&
                        row.latestVersionReviewStatus === 'pending' ? (
                          <Button
                            size="sm"
                            variant="primary"
                            type="button"
                            disabled={publishMutation.isPending}
                            onClick={() => publishMutation.mutate(row.latestVersionId!)}
                          >
                            Publish
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-6 flex flex-col gap-3 border-t border-outline-variant/15 pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-on-surface-variant">
                {catalogTotal === 0
                  ? 'No results'
                  : `Showing ${(catalogPage - 1) * catalogLimit + 1}–${Math.min(
                      catalogPage * catalogLimit,
                      catalogTotal,
                    )} of ${catalogTotal}`}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={catalogPage <= 1 || catalogQuery.isLoading}
                  onClick={() => setCatalogPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </Button>
                <span className="px-1 text-sm text-on-surface-variant">
                  Page {catalogPage} / {catalogTotalPages}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={catalogPage >= catalogTotalPages || catalogQuery.isLoading}
                  onClick={() => setCatalogPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <Card className="border-outline-variant/10 bg-surface-container-low/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Related</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <Link href="/admin/databases" className="text-primary hover:underline">
                Databases catalog
              </Link>
              <Link href="/admin/rankings" className="text-primary hover:underline">
                Rankings
              </Link>
            </CardContent>
          </Card>
        </aside>
      </div>

      {reviewQueueOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-3 py-6 backdrop-blur-sm sm:px-4"
          onClick={() => setReviewQueueOpen(false)}
          role="presentation"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-queue-title"
            className="flex max-h-[min(90vh,880px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-outline-variant/15 bg-surface-container-low shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-outline-variant/10 px-5 py-4 sm:px-6">
              <div>
                <h2 id="review-queue-title" className="text-lg font-semibold text-on-surface">
                  Review queue
                </h2>
                <p className="mt-1 text-sm text-on-surface-variant">
                  Drafts with a pending version — publish or send feedback to the author.
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setReviewQueueOpen(false)}>
                Close
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-3 py-4 sm:px-6">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Challenge</TableHead>
                      <TableHead>Database</TableHead>
                      <TableHead>Difficulty</TableHead>
                      <TableHead>Author</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reviewQuery.isLoading ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-sm text-on-surface-variant">
                          Loading…
                        </TableCell>
                      </TableRow>
                    ) : reviewQuery.isError ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-sm text-error">
                          Could not load review queue.
                        </TableCell>
                      </TableRow>
                    ) : reviewRows.length === 0 ? (
                      <TableEmpty message="No challenges waiting for review." colSpan={6} />
                    ) : (
                      reviewRows.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>
                            <div className="font-medium text-on-surface">{row.title}</div>
                            <div className="font-mono text-xs text-on-surface-variant">{row.slug}</div>
                          </TableCell>
                          <TableCell className="text-sm text-on-surface-variant">
                            {row.databaseName ?? '—'}
                          </TableCell>
                          <TableCell>
                            <DifficultyBadge difficulty={row.difficulty} className="capitalize" />
                          </TableCell>
                          <TableCell className="text-sm text-on-surface-variant">
                            {row.createdBy?.username ?? row.createdBy?.displayName ?? '—'}
                          </TableCell>
                          <TableCell className="text-sm text-on-surface-variant whitespace-nowrap">
                            {formatDate(row.updatedAt)}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex flex-wrap justify-end gap-2">
                              {row.latestVersionId ? (
                                <>
                                  <Button
                                    size="sm"
                                    variant="primary"
                                    disabled={publishMutation.isPending}
                                    onClick={() => publishMutation.mutate(row.latestVersionId!)}
                                  >
                                    Publish
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() =>
                                      setDecisionModal({
                                        open: true,
                                        versionId: row.latestVersionId!,
                                        challengeTitle: row.title,
                                        decision: 'request_changes',
                                      })
                                    }
                                  >
                                    Request changes
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="destructive"
                                    onClick={() =>
                                      setDecisionModal({
                                        open: true,
                                        versionId: row.latestVersionId!,
                                        challengeTitle: row.title,
                                        decision: 'reject',
                                      })
                                    }
                                  >
                                    Reject
                                  </Button>
                                </>
                              ) : (
                                <span className="text-xs text-outline">No version</span>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {decisionModal.open ? (
        <ConfirmModal
          open
          zIndexClass="z-[60]"
          title={decisionModal.decision === 'reject' ? 'Reject draft' : 'Request changes'}
          description={
            <span>
              <strong>{decisionModal.challengeTitle}</strong>
              {decisionModal.decision === 'reject'
                ? ' will stay in draft with a rejected review.'
                : ' stays in draft; the author should revise and resubmit.'}
            </span>
          }
          confirmLabel={decisionModal.decision === 'reject' ? 'Reject' : 'Send feedback'}
          confirmVariant={decisionModal.decision === 'reject' ? 'destructive' : 'primary'}
          isPending={reviewMutation.isPending}
          onCancel={() => {
            if (!reviewMutation.isPending) {
              setDecisionModal({ open: false });
              setReviewNote('');
            }
          }}
          onConfirm={() =>
            reviewMutation.mutate({
              versionId: decisionModal.versionId,
              decision: decisionModal.decision,
              note: reviewNote.trim() || undefined,
            })
          }
        >
          <Textarea
            label="Note to author (optional)"
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            rows={3}
            className="mt-3"
          />
        </ConfirmModal>
      ) : null}
    </div>
  );
}
