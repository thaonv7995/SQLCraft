'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/dashboard', label: 'Home', icon: 'dashboard' },
  { href: '/explore', label: 'Data', icon: 'database' },
  { href: '/lab', label: 'Lab', icon: 'terminal' },
  { href: '/leaderboard', label: 'Challenges', icon: 'target' },
] as const;

export function MobileAppNav() {
  const pathname = usePathname() ?? '';

  if (/^\/lab\/.+/.test(pathname)) {
    return null;
  }

  return (
    <nav
      aria-label="App sections"
      className="fixed bottom-0 left-0 right-0 z-40 border-t border-outline-variant/20 bg-surface-container-low/95 backdrop-blur-md md:hidden pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-7xl items-stretch justify-around px-1 py-1.5">
        {ITEMS.map((item) => {
          const active =
            pathname === item.href ||
            (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-lg py-1.5 text-[10px] font-medium transition-colors',
                active
                  ? 'text-on-surface bg-surface-container-high'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/60'
              )}
            >
              <span
                className="material-symbols-outlined text-[22px] leading-none"
                style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}
              >
                {item.icon}
              </span>
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
