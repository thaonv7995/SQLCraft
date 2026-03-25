'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { User } from '@/lib/api';
import { useMounted } from '@/hooks/use-mounted';
import { useAuthStore } from '@/stores/auth';
import { generateInitials } from '@/lib/utils';

function isAdminUser(user: User): boolean {
  return user.role === 'admin' || (user.roles?.includes('admin') ?? false);
}

function buildUserMenuItems(user: User) {
  const items: { href: string; label: string; icon: string }[] = [
    { href: '/profile', label: 'Profile', icon: 'person' },
    { href: '/settings', label: 'Settings', icon: 'settings' },
    { href: '/docs', label: 'Documentation', icon: 'menu_book' },
    { href: '/history', label: 'Query History', icon: 'history' },
    { href: '/submissions', label: 'Submissions', icon: 'code' },
  ];
  if (isAdminUser(user)) {
    items.push({ href: '/admin', label: 'Admin Panel', icon: 'admin_panel_settings' });
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
  const menuItems = adminShell ? [] : buildUserMenuItems(user);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg p-1 hover:bg-surface-container-high transition-colors"
        aria-label="User menu"
      >
        {avatarUrl ? (
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

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isAuthenticated } = useAuthStore();
  const mounted = useMounted();
  const authed = mounted && isAuthenticated();
  const inAdminShell = pathname.startsWith('/admin');
  const homeHref = authed && user && isAdminUser(user) ? '/admin' : authed ? '/dashboard' : '/';

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 flex h-14 w-full items-center justify-between gap-4 border-b border-outline-variant/20 bg-surface-container-low px-3 sm:px-4 lg:px-6"
      aria-label="Primary"
    >
      {/* Brand — điều hướng chi tiết ở sidebar / bottom nav */}
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
            <button
              className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors relative"
              aria-label="Notifications"
            >
              <span className="material-symbols-outlined text-lg">notifications</span>
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-on-surface-variant" />
            </button>

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
