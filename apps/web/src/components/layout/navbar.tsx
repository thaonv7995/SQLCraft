'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuthStore } from '@/stores/auth';
import { generateInitials } from '@/lib/utils';

const NAV_LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/explore', label: 'Databases' },
  { href: '/lab', label: 'Workspace' },
  { href: '/docs', label: 'Documentation' },
];

function UserAvatar({ displayName, avatarUrl }: { displayName: string; avatarUrl?: string }) {
  const [open, setOpen] = useState(false);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const initials = generateInitials(displayName);

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
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-[#4453a7] flex items-center justify-center text-[#00105b] text-xs font-bold font-headline">
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
            <nav className="py-1">
              {[
                { href: '/profile', label: 'Profile', icon: 'person' },
                { href: '/settings', label: 'Settings', icon: 'settings' },
                { href: '/history', label: 'Query History', icon: 'history' },
                { href: '/contributor', label: 'Contributor', icon: 'code' },
                { href: '/admin', label: 'Admin Panel', icon: 'admin_panel_settings' },
              ].map((item) => (
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
  const authed = isAuthenticated();

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 h-14 bg-surface flex items-center px-4 lg:px-6"
    >
      {/* Brand */}
      <Link
        href={authed ? '/dashboard' : '/'}
        className="flex items-center gap-2.5 mr-8 shrink-0"
      >
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary to-[#4453a7] flex items-center justify-center">
          <span className="material-symbols-outlined text-sm text-[#00105b]">database</span>
        </div>
        <span className="font-headline font-bold text-sm uppercase tracking-widest text-on-surface hidden sm:block">
          The Architectural Lab
        </span>
      </Link>

      {/* Nav links */}
      {authed && (
        <div className="hidden md:flex items-center gap-1 flex-1">
          {NAV_LINKS.map((link) => {
            const active = pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-sm font-medium font-body transition-colors',
                  active
                    ? 'text-primary bg-primary/10'
                    : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high'
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-3 ml-auto">
        {authed ? (
          <>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<span className="material-symbols-outlined text-sm">play_arrow</span>}
              onClick={() => router.push('/lab')}
              className="hidden sm:inline-flex"
            >
              Execute Query
            </Button>

            {/* Notifications */}
            <button
              className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors relative"
              aria-label="Notifications"
            >
              <span className="material-symbols-outlined text-lg">notifications</span>
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary" />
            </button>

            {user && (
              <UserAvatar
                displayName={user.displayName ?? user.username}
                avatarUrl={user.avatarUrl}
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
