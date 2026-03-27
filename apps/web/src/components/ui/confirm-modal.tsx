'use client';

import { useEffect, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function ConfirmModal({
  open,
  title,
  description,
  children,
  eyebrow,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  confirmVariant = 'destructive',
  icon = 'warning',
  isPending,
  onCancel,
  onConfirm,
  zIndexClass = 'z-50',
  titleId = 'confirm-modal-title',
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  children?: ReactNode;
  eyebrow?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'destructive' | 'primary' | 'secondary';
  icon?: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  zIndexClass?: string;
  titleId?: string;
}) {
  useEffect(() => {
    if (!open || isPending) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isPending, onCancel, open]);

  if (!open) {
    return null;
  }

  const iconWrapClass =
    confirmVariant === 'destructive'
      ? 'bg-error/10 text-error'
      : 'bg-tertiary/10 text-tertiary';

  return (
    <div
      className={cn(
        'fixed inset-0 flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm',
        zIndexClass,
      )}
      onClick={() => {
        if (!isPending) {
          onCancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md rounded-xl border border-outline-variant/15 bg-surface-container-low p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start gap-4">
          <div
            className={cn(
              'flex h-11 w-11 shrink-0 items-center justify-center rounded-full',
              iconWrapClass,
            )}
          >
            <span className="material-symbols-outlined text-[22px]">{icon}</span>
          </div>
          <div className="min-w-0">
            {eyebrow ? (
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-outline">
                {eyebrow}
              </p>
            ) : null}
            <h2
              id={titleId}
              className={cn(
                'text-lg font-semibold text-on-surface',
                eyebrow ? 'mt-1' : '',
              )}
            >
              {title}
            </h2>
            <div className="mt-2 text-sm leading-6 text-on-surface-variant">{description}</div>
          </div>
        </div>
        {children ? <div className="mt-3">{children}</div> : null}
        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={isPending}>
            {cancelLabel}
          </Button>
          <Button variant={confirmVariant} loading={isPending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
