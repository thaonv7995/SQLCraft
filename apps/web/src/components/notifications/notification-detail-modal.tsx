'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import type { InAppNotificationItem } from '@/lib/api';
import { Button } from '@/components/ui/button';

function exploreHrefFromMetadata(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null;
  const id = metadata.databaseId;
  if (typeof id !== 'string' || !id.trim()) return null;
  return `/explore/${encodeURIComponent(id.trim())}`;
}

/** Rút gọn cho dòng preview trong list (thêm ... khi quá dài). */
export function truncatePreview(text: string, maxChars: number): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars).trimEnd()}...`;
}

export function NotificationDetailModal({
  notification,
  onClose,
}: {
  notification: InAppNotificationItem | null;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!notification) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [notification, onClose]);

  if (!notification) return null;

  const meta =
    notification.metadata && typeof notification.metadata === 'object' && !Array.isArray(notification.metadata)
      ? (notification.metadata as Record<string, unknown>)
      : null;
  const exploreHref = exploreHrefFromMetadata(meta);

  return (
    <>
      <div
        className="fixed inset-0 z-[100] bg-black/45 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        className="fixed left-1/2 top-1/2 z-[101] w-[min(100vw-1.5rem,28rem)] max-h-[min(85vh,36rem)] -translate-x-1/2 -translate-y-1/2 flex flex-col rounded-2xl border border-outline-variant/40 bg-surface-container-high shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notif-detail-title"
      >
        <div className="flex items-start justify-between gap-2 border-b border-outline-variant/30 px-4 py-3 shrink-0">
          <h3 id="notif-detail-title" className="text-base font-semibold text-on-surface leading-snug pr-2">
            {notification.title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-on-surface-variant hover:bg-surface-container-highest"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-xl">close</span>
          </button>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0 px-4 py-3 space-y-3">
          {notification.body ? (
            <p className="text-sm text-on-surface-variant whitespace-pre-wrap break-words">{notification.body}</p>
          ) : (
            <p className="text-sm text-on-surface-variant italic">No message body.</p>
          )}
          <p className="text-xs text-outline">
            {new Date(notification.createdAt).toLocaleString()} ·{' '}
            <span className="font-mono">{notification.type}</span>
          </p>
          {exploreHref ? (
            <div className="pt-1">
              <Link
                href={exploreHref}
                onClick={onClose}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <span className="material-symbols-outlined text-base">open_in_new</span>
                Open in Explore
              </Link>
            </div>
          ) : null}
        </div>
        <div className="border-t border-outline-variant/30 px-4 py-3 shrink-0">
          <Button type="button" variant="primary" size="sm" className="w-full" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </>
  );
}
