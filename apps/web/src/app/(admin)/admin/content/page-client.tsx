'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { DifficultyBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ui/confirm-modal';
import { Textarea } from '@/components/ui/input';
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
import {
  DATABASE_DIFFICULTY_STYLES,
  DATABASE_DOMAIN_LABELS,
  DATABASE_DOMAIN_OPTIONS,
} from '@/lib/database-catalog';
import { cn, formatDate } from '@/lib/utils';
import type { ClientPageProps } from '@/lib/page-props';
import toast from 'react-hot-toast';

const emptyReview: ChallengeReviewItem[] = [];

const CATALOG_STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
] as const;

const CATALOG_PAGE_LIMIT = 20;

const DOMAIN_DEFAULT_ICONS: Record<DatabaseDomain, string> = {
  ecommerce: 'storefront',
  fintech: 'account_balance',
  health: 'medical_services',
  iot: 'sensors',
  social: 'groups',
  analytics: 'analytics',
  other: 'database',
};

function FilterSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="appearance-none cursor-pointer rounded-lg border border-outline-variant/20 bg-surface-container-low py-2 pl-3 pr-8 text-xs font-medium text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="material-symbols-outlined pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-base text-outline">
        expand_more
      </span>
    </div>
  );
}

function CatalogMetric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-outline">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-on-surface">{value}</p>
      <p className="mt-1 text-xs text-on-surface-variant">{hint}</p>
    </div>
  );
}

function ChallengeCatalogCard({
  row,
  domainIcon,
  publishPending,
  onPublish,
}: {
  row: AdminChallengeCatalogItem;
  domainIcon: string;
  publishPending: boolean;
  onPublish: (versionId: string) => void;
}) {
  const difficulty =
    DATABASE_DIFFICULTY_STYLES[row.difficulty] ?? DATABASE_DIFFICULTY_STYLES.beginner;
  const showPublish =
    Boolean(row.latestVersionId) &&
    row.status === 'draft' &&
    row.latestVersionReviewStatus === 'pending';

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-surface-container-highest">
            <span
              className="material-symbols-outlined text-xl text-tertiary"
              style={{ fontVariationSettings: "'FILL' 1" }}
              aria-hidden
            >
              {domainIcon}
            </span>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-on-surface group-hover:text-primary">
              {row.title}
            </p>
            <p className="mt-1 text-xs text-on-surface-variant">
              {DATABASE_DOMAIN_LABELS[row.catalogDomain]}
            </p>
          </div>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider',
            difficulty.badge,
          )}
        >
          {difficulty.label}
        </span>
      </div>

      <p className="mt-4 line-clamp-2 text-sm leading-relaxed text-on-surface-variant">
        {row.description?.trim() ? row.description : '—'}
      </p>

      <div className="mt-4 flex flex-wrap gap-1.5">
        <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
          {row.status}
        </span>
        <span className="max-w-full truncate rounded-full bg-surface-container-high px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
          {row.slug}
        </span>
        {row.validatorType ? (
          <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider text-on-surface-variant">
            {row.validatorType}
          </span>
        ) : null}
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-outline-variant/10 pt-4">
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-outline">Points</p>
          <p className="mt-1 font-mono text-sm font-semibold text-on-surface">{row.points}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-outline">Database</p>
          <p className="mt-1 line-clamp-1 font-mono text-sm font-semibold text-on-surface">
            {row.databaseName ?? '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-[0.16em] text-outline">Updated</p>
          <p className="mt-1 font-mono text-sm font-semibold capitalize text-tertiary">
            {formatDate(row.updatedAt)}
          </p>
        </div>
      </div>
    </>
  );

  if (row.status === 'published') {
    return (
      <Link
        href={`/admin/content/${row.id}`}
        className="group block rounded-xl border border-outline-variant/10 bg-surface-container-low p-5 transition-colors hover:border-outline-variant/30 hover:bg-surface-container"
      >
        {inner}
      </Link>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-outline-variant/10 bg-surface-container-low">
      <Link
        href={`/admin/content/${row.id}`}
        className="group block p-5 transition-colors hover:bg-surface-container"
      >
        {inner}
      </Link>
      {showPublish ? (
        <div className="flex flex-wrap gap-2 border-t border-outline-variant/10 px-5 py-4">
          <Button
            size="sm"
            variant="primary"
            type="button"
            disabled={publishPending}
            onClick={() => onPublish(row.latestVersionId!)}
          >
            Publish
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ChallengeCatalogSkeleton() {
  return (
    <div className="rounded-xl bg-surface-container-low p-5">
      <div className="flex items-start justify-between">
        <div className="flex gap-3">
          <div className="h-11 w-11 animate-pulse rounded-lg bg-surface-container-high" />
          <div className="space-y-2">
            <div className="h-4 w-36 animate-pulse rounded bg-surface-container-high" />
            <div className="h-3 w-20 animate-pulse rounded bg-surface-container-high" />
          </div>
        </div>
        <div className="h-5 w-20 animate-pulse rounded-full bg-surface-container-high" />
      </div>
      <div className="mt-4 h-4 w-full animate-pulse rounded bg-surface-container-high" />
      <div className="mt-2 h-4 w-4/5 animate-pulse rounded bg-surface-container-high" />
      <div className="mt-4 flex gap-2">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="h-5 w-14 animate-pulse rounded-full bg-surface-container-high"
          />
        ))}
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3 border-t border-outline-variant/10 pt-4">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="space-y-2">
            <div className="h-3 w-14 animate-pulse rounded bg-surface-container-high" />
            <div className="h-4 w-16 animate-pulse rounded bg-surface-container-high" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AdminContentChallengesPage(_props: ClientPageProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const databasesQuery = useQuery({
    queryKey: ['admin-content-databases', { includeAwaitingGolden: true }],
    // API enforces limit ≤ 100 (ListDatabasesQuerySchema); higher values fail validation.
    queryFn: () => databasesApi.list({ limit: 100, page: 1, includeAwaitingGolden: true }),
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

  const handleCatalogDomainChange = (value: string) => {
    setCatalogDomain(value);
    setCatalogPage(1);
  };

  const handleCatalogDatabaseIdChange = (value: string) => {
    setCatalogDatabaseId(value);
    setCatalogPage(1);
  };

  const handleCatalogStatusChange = (value: 'all' | 'draft' | 'published' | 'archived') => {
    setCatalogStatus(value);
    setCatalogPage(1);
  };

  const catalogDatabaseSelectOptions = useMemo(() => {
    const items = databasesQuery.data?.items ?? [];
    return items
      .filter((d) => catalogDomain === 'all' || d.domain === catalogDomain)
      .map((d) => ({
        value: d.schemaTemplateId ?? d.id,
        label: d.name,
      }));
  }, [databasesQuery.data?.items, catalogDomain]);

  const databaseIconByTemplateId = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of databasesQuery.data?.items ?? []) {
      map.set(d.schemaTemplateId ?? d.id, d.domainIcon);
    }
    return map;
  }, [databasesQuery.data?.items]);

  function domainIconForChallenge(row: AdminChallengeCatalogItem): string {
    if (row.databaseId && databaseIconByTemplateId.has(row.databaseId)) {
      return databaseIconByTemplateId.get(row.databaseId)!;
    }
    return DOMAIN_DEFAULT_ICONS[row.catalogDomain] ?? 'quiz';
  }

  useEffect(() => {
    if (!catalogDatabaseId) return;
    const ok = catalogDatabaseSelectOptions.some((o) => o.value === catalogDatabaseId);
    if (!ok) {
      queueMicrotask(() => {
        setCatalogDatabaseId('');
        setCatalogPage(1);
      });
    }
  }, [catalogDatabaseSelectOptions, catalogDatabaseId]);

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
      CATALOG_PAGE_LIMIT,
      catalogDomain,
      catalogDatabaseId,
      catalogStatus,
    ],
    queryFn: () =>
      challengesApi.listAdminCatalog({
        page: catalogPage,
        limit: CATALOG_PAGE_LIMIT,
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

  const reviewRows = reviewQuery.data ?? emptyReview;
  const reviewPendingCount = reviewRows.length;
  const catalog = catalogQuery.data;
  const catalogRows = catalog?.items ?? [];
  const catalogTotal = catalog?.total ?? 0;
  const catalogTotalPages = Math.max(1, catalog?.totalPages ?? 1);

  return (
    <div className="page-shell-wide page-stack pb-10">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <h1 className="page-title">Challenges</h1>
          <p className="page-lead mt-2">
            Manage practice challenges like the database catalog: filter the list, open a card to
            view the live page, or use the review queue for drafts awaiting approval.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
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

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <CatalogMetric
          label="Matching challenges"
          value={catalogQuery.isLoading ? '—' : String(catalogTotal)}
          hint="Total count for the current filters (all pages)."
        />
        <CatalogMetric
          label="On this page"
          value={catalogQuery.isLoading ? '—' : String(catalogRows.length)}
          hint="Challenges shown in the grid below."
        />
        <CatalogMetric
          label="Pending review"
          value={reviewQuery.isLoading ? '—' : String(reviewPendingCount)}
          hint="Drafts with a version waiting in the review queue."
        />
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="page-section-title">Challenge catalog</h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            Select a challenge to open its admin detail (use “View ranking” for published challenges), or publish drafts when they are ready.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            value={catalogDomain}
            onChange={handleCatalogDomainChange}
            options={DATABASE_DOMAIN_OPTIONS}
          />
          <FilterSelect
            value={catalogDatabaseId}
            onChange={handleCatalogDatabaseIdChange}
            options={[
              {
                value: '',
                label: databasesQuery.isLoading ? 'Loading…' : 'All databases',
              },
              ...catalogDatabaseSelectOptions.map((o) => ({ value: o.value, label: o.label })),
            ]}
          />
          <FilterSelect
            value={catalogStatus}
            onChange={(v) =>
              handleCatalogStatusChange(v as 'all' | 'draft' | 'published' | 'archived')
            }
            options={[...CATALOG_STATUS_OPTIONS]}
          />
        </div>
      </div>

      {catalogQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <ChallengeCatalogSkeleton key={i} />
          ))}
        </div>
      ) : catalogQuery.isError ? (
        <div className="rounded-xl border border-error/20 bg-error/5 px-5 py-4 text-sm text-error">
          Could not load challenge catalog.
        </div>
      ) : catalogRows.length === 0 ? (
        <div className="rounded-xl border border-outline-variant/10 bg-surface-container-low px-5 py-8 text-center">
          <p className="text-sm font-medium text-on-surface">No challenges match these filters</p>
          <p className="mt-1 text-sm text-on-surface-variant">Try widening domain or status.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
          {catalogRows.map((row) => (
            <ChallengeCatalogCard
              key={row.id}
              row={row}
              domainIcon={domainIconForChallenge(row)}
              publishPending={publishMutation.isPending}
              onPublish={(versionId) => publishMutation.mutate(versionId)}
            />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-outline-variant/15 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-on-surface-variant">
          {catalogTotal === 0
            ? 'No results'
            : `Showing ${(catalogPage - 1) * CATALOG_PAGE_LIMIT + 1}–${Math.min(
                catalogPage * CATALOG_PAGE_LIMIT,
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
