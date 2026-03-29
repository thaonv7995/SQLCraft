'use client';

import Link from 'next/link';
import { useCallback, useEffect } from 'react';
import toast from 'react-hot-toast';
import { useQueryClient } from '@tanstack/react-query';
import { DatabaseImportPanel } from '@/components/admin/database-import-panel';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth';

export type ExploreDatabaseImportModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCatalogUpdated?: () => void;
};

/**
 * Controlled import dialog for Database Explorer (trigger button lives in parent toolbar).
 */
export function ExploreDatabaseImportModal({
  open,
  onOpenChange,
  onCatalogUpdated,
}: ExploreDatabaseImportModalProps) {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuthStore();
  const authed = isAuthenticated();

  useEffect(() => {
    if (!open) {
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onOpenChange]);

  const handleImported = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['catalog-databases'] });
    void queryClient.invalidateQueries({ queryKey: ['databases'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard-databases'] });
    onCatalogUpdated?.();
  }, [queryClient, onCatalogUpdated]);

  const closeModal = useCallback(() => onOpenChange(false), [onOpenChange]);

  const handleAfterUserImport = useCallback(
    (ctx: { visibility: 'public' | 'private' }) => {
      if (ctx.visibility === 'public') {
        toast.success(
          'Submitted successfully. It appears in Explorer as Reviewing until an admin approves it.',
        );
      } else {
        toast.success('Database imported. You can use it when authoring challenges.');
      }
      closeModal();
    },
    [closeModal],
  );

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 px-0 pb-0 pt-10 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={closeModal}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="explore-import-dialog-title"
        className="flex max-h-[min(92dvh,900px)] w-full max-w-6xl flex-col rounded-t-2xl border border-outline-variant/15 bg-surface-container-low shadow-[0_24px_80px_rgba(0,0,0,0.35)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-outline-variant/10 px-5 py-4 sm:px-6">
          <h2
            id="explore-import-dialog-title"
            className="font-headline text-lg font-semibold text-on-surface sm:text-xl"
          >
            Import database
          </h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={closeModal}
            aria-label="Close import dialog"
          >
            <span className="material-symbols-outlined text-[22px] leading-none">close</span>
          </Button>
        </div>

        <div className="min-h-0 w-full min-w-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5">
          {!authed ? (
            <div className="rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-8 text-center">
              <p className="text-sm text-on-surface-variant">Sign in to upload a SQL file.</p>
              <Link href="/login" className="mt-4 inline-block">
                <Button variant="primary" size="sm">
                  Sign in
                </Button>
              </Link>
            </div>
          ) : (
            <DatabaseImportPanel
              variant="user"
              onImported={handleImported}
              onAfterUserImport={handleAfterUserImport}
            />
          )}
        </div>
      </div>
    </div>
  );
}
