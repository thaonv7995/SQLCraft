'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { notificationsApi, type InAppNotificationItem, type User } from '@/lib/api';
import {
  NotificationDetailModal,
  truncatePreview,
} from '@/components/notifications/notification-detail-modal';
import { useMounted } from '@/hooks/use-mounted';
import { useAuthStore } from '@/stores/auth';
import { generateInitials } from '@/lib/utils';

function isAdminUser(user: User): boolean {
  return user.role === 'admin' || (user.roles?.includes('admin') ?? false);
}

function buildUserMenuItems(user: User) {
  const items: { href: string; label: string; icon: string }[] = [
    { href: '/profile', label: 'Profile', icon: 'person' },
    { href: '/explore?import=1', label: 'Import database', icon: 'upload_file' },
    { href: '/settings', label: 'Settings', icon: 'settings' },
    { href: '/docs', label: 'Documentation', icon: 'menu_book' },
    { href: '/history', label: 'Query History', icon: 'history' },
  ];
  if (isAdminUser(user)) {
    items.push({ href: '/admin', label: 'Admin Panel', icon: 'admin_panel_settings' });
  }
  return items;
}

function buildAdminShellMenuItems(user: User) {
  const items: { href: string; label: string; icon: string }[] = [
    { href: '/dashboard', label: 'Back to app', icon: 'home' },
    { href: '/profile', label: 'Profile', icon: 'person' },
    { href: '/settings', label: 'Settings', icon: 'settings' },
  ];
  if (isAdminUser(user)) {
    items.push({ href: '/admin', label: 'Admin overview', icon: 'dashboard' });
  }
  return items;
}

function UserAvatar({
  displayName,
  avatarUrl,
  user,
  adminShell,
}: {
  displayName: string;
  avatarUrl?: string | null;
  user: User;
  adminShell: boolean;
}) {
  const [open, setOpen] = useState(false);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const initials = generateInitials(displayName);
  const menuItems = adminShell ? buildAdminShellMenuItems(user) : buildUserMenuItems(user);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg p-1 hover:bg-surface-container-high transition-colors"
        aria-label="User menu"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- user avatar from API; arbitrary host
          <img
            src={avatarUrl}
            alt={displayName}
            className="w-7 h-7 rounded-full object-cover"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-surface-container-highest border border-outline-variant flex items-center justify-center text-on-surface text-xs font-bold font-headline">
            {initials}
          </div>
        )}
        <span className="text-sm font-medium text-on-surface hidden sm:block">{displayName}</span>
        <span className="material-symbols-outlined text-base text-on-surface-variant">
          expand_more
        </span>
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-1 w-48 bg-surface-container-high rounded-xl shadow-xl shadow-black/50 z-20 overflow-hidden">
            <div className="px-3 py-2.5 bg-surface-container-highest/50">
              <p className="text-sm font-medium text-on-surface truncate">{displayName}</p>
            </div>
            {menuItems.length > 0 ? (
              <nav className="py-1">
                {menuItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2 text-sm text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest transition-colors"
                  >
                    <span className="material-symbols-outlined text-base">{item.icon}</span>
                    {item.label}
                  </Link>
                ))}
              </nav>
            ) : null}
            <div className="bg-surface-container-highest/30 py-1">
              <button
                onClick={() => {
                  clearAuth();
                  window.location.href = '/login';
                }}
                className="flex items-center gap-2.5 w-full px-3 py-2 text-sm text-error hover:bg-error/5 transition-colors"
              >
                <span className="material-symbols-outlined text-base">logout</span>
                Sign Out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

let unreadCountWarmupAt = 0;

function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<InAppNotificationItem | null>(null);
  const [items, setItems] = useState<InAppNotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const refreshUnread = useCallback(async () => {
    try {
      const { unreadCount: n } = await notificationsApi.unreadCount();
      setUnreadCount(n);
    } catch {
      /* ignore — badge is best-effort */
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await notificationsApi.list({ page: 1, limit: 15, unreadOnly: false });
      setItems(res.items);
      setUnreadCount(res.unreadCount);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const now = Date.now();
    if (now - unreadCountWarmupAt < 1_000) {
      return;
    }
    unreadCountWarmupAt = now;
    void refreshUnread();
  }, [refreshUnread]);

  /** Mở panel = coi như đã xem: đánh dấu tất cả đã đọc rồi mới load list. */
  const openSeq = useRef(0);
  useEffect(() => {
    if (!open) return;
    const seq = ++openSeq.current;
    let cancelled = false;
    void (async () => {
      try {
        await notificationsApi.markAllRead();
      } catch {
        /* ignore */
      }
      if (cancelled || seq !== openSeq.current) return;
      await loadList();
      if (cancelled || seq !== openSeq.current) return;
      await refreshUnread();
    })();
    return () => {
      cancelled = true;
    };
  }, [open, loadList, refreshUnread]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors relative"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <span className="material-symbols-outlined text-lg">notifications</span>
        {unreadCount > 0 ? (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-error text-[10px] font-bold text-on-error flex items-center justify-center leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
          <div
            className="absolute right-0 top-full mt-1 z-20 w-[min(100vw-1.5rem,22rem)] max-h-[min(24rem,70vh)] flex flex-col rounded-xl border border-outline-variant/40 bg-surface-container-high shadow-xl shadow-black/40 overflow-hidden"
            role="dialog"
            aria-label="Notification list"
          >
            <div className="px-3 py-2 border-b border-outline-variant/30 bg-surface-container-highest/40">
              <span className="text-sm font-semibold text-on-surface">Notifications</span>
            </div>
            <div className="overflow-y-auto flex-1 min-h-0">
              {loading ? (
                <p className="px-3 py-6 text-center text-sm text-on-surface-variant">Loading…</p>
              ) : items.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-on-surface-variant">No notifications yet</p>
              ) : (
                <ul className="py-1">
                  {items.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => setDetail(n)}
                        className="w-full text-left px-3 py-2.5 text-sm transition-colors hover:bg-surface-container-highest/80 opacity-90"
                      >
                        <p className="font-medium text-on-surface line-clamp-1" title={n.title}>
                          {truncatePreview(n.title, 72)}
                        </p>
                        {n.body ? (
                          <p className="mt-0.5 text-xs text-on-surface-variant line-clamp-2" title={n.body}>
                            {truncatePreview(n.body, 140)}
                          </p>
                        ) : null}
                        <p className="mt-1 text-[10px] text-outline">
                          {new Date(n.createdAt).toLocaleString()}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="border-t border-outline-variant/30 px-3 py-2 bg-surface-container-highest/30">
              <Link
                href="/settings"
                className="block text-center text-xs font-medium text-primary hover:underline"
                onClick={() => setOpen(false)}
              >
                View all in Settings
              </Link>
            </div>
          </div>
        </>
      )}

      <NotificationDetailModal notification={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated } = useAuthStore();
  const mounted = useMounted();
  const authed = mounted && isAuthenticated();
  const inAdminShell = pathname.startsWith('/admin');
  const homeHref = authed ? '/dashboard' : '/';

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 flex h-14 w-full items-center justify-between gap-4 border-b border-outline-variant/20 bg-surface-container-low px-3 sm:px-4 lg:px-6"
      aria-label="Primary"
    >
      {/* Brand — detailed nav lives in sidebar / bottom nav */}
      <Link
        href={homeHref}
        className="flex min-w-0 shrink-0 items-center gap-2.5"
      >
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-outline-variant/40 bg-surface-container-high">
          <span className="material-symbols-outlined text-sm text-on-surface">database</span>
        </div>
        <span className="hidden font-headline text-sm font-semibold tracking-tight text-on-surface sm:block">
          SQLCraft
        </span>
      </Link>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        {authed ? (
          <>
            {!inAdminShell ? (
              <Button
                variant="primary"
                size="sm"
                leftIcon={<span className="material-symbols-outlined text-sm">play_arrow</span>}
                onClick={() => router.push('/lab')}
                className="hidden md:inline-flex"
              >
                Execute Query
              </Button>
            ) : null}

            {/* Notifications */}
            <NotificationsBell />

            {user && (
              <UserAvatar
                user={user}
                displayName={user.displayName ?? user.username}
                avatarUrl={user.avatarUrl}
                adminShell={inAdminShell}
              />
            )}
          </>
        ) : (
          <>
            <Link href="/login">
              <Button variant="ghost" size="sm">Sign In</Button>
            </Link>
            <Link href="/register">
              <Button variant="primary" size="sm">Get Started</Button>
            </Link>
          </>
        )}
      </div>
    </nav>
  );
}
