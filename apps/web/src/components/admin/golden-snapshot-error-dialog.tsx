'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/button';
import { adminApi } from '@/lib/api';
import { cn } from '@/lib/utils';

export function GoldenSnapshotErrorDialog({
  open,
  databaseId,
  databaseName,
  schemaTemplateId,
  error,
  onClose,
}: {
  open: boolean;
  databaseId: string;
  databaseName: string;
  schemaTemplateId: string | null | undefined;
  error: string | null | undefined;
  onClose: () => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const retriggerMutation = useMutation({
    mutationFn: () => {
      if (!schemaTemplateId) throw new Error('No schema template ID');
      return adminApi.retriggerGoldenBake(schemaTemplateId);
    },
    onSuccess: () => {
      toast.success('Golden bake queued — status will update shortly');
      void queryClient.invalidateQueries({ queryKey: ['admin-database-catalog'] });
      void queryClient.invalidateQueries({ queryKey: ['admin-database'] });
      onClose();
    },
    onError: () => {
      toast.error('Failed to retrigger golden bake');
    },
  });

  const handleCopy = () => {
    if (!error) return;
    void navigator.clipboard.writeText(error).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="golden-error-dialog-title"
        className="flex w-full max-w-xl flex-col rounded-xl border border-outline-variant/15 bg-surface-container-low shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-4 p-6 pb-4">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-error/10 text-error">
            <span className="material-symbols-outlined text-[22px]">error</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
              Golden Snapshot
            </p>
            <h2
              id="golden-error-dialog-title"
              className="mt-1 text-lg font-semibold text-on-surface"
            >
              Bake failed
            </h2>
            <p className="mt-1 text-sm text-on-surface-variant">
              <span className="font-medium text-on-surface">{databaseName}</span> — the source
              dataset could not be baked into a golden snapshot.
            </p>
          </div>
        </div>

        {/* Error detail */}
        <div className="mx-6 mb-4">
          <div className="relative rounded-lg border border-error/20 bg-error/5">
            <pre className="max-h-52 overflow-y-auto p-4 text-[11px] leading-relaxed text-error/90 whitespace-pre-wrap break-words font-mono">
              {error ?? 'No error details available.'}
            </pre>
            <button
              type="button"
              onClick={handleCopy}
              className={cn(
                'absolute right-2 top-2 rounded px-2 py-0.5 text-[10px] font-medium transition-colors',
                copied
                  ? 'bg-secondary/20 text-secondary'
                  : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface',
              )}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-outline-variant/10 p-6 pt-4">
          <p className="text-xs text-on-surface-variant">
            Retry the bake, replace the SQL dump, or inspect the database.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Dismiss
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                onClose();
                router.push(
                  `/admin/databases?view=import&replace=${encodeURIComponent(schemaTemplateId ?? databaseId)}`,
                );
              }}
            >
              Replace SQL
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                onClose();
                router.push(`/admin/databases/${databaseId}`);
              }}
            >
              View Database
            </Button>
            <Button
              variant="primary"
              loading={retriggerMutation.isPending}
              disabled={!schemaTemplateId}
              onClick={() => retriggerMutation.mutate()}
            >
              Retry Bake
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
