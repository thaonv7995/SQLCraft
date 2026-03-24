'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const MAIN_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { href: '/explore', label: 'Databases', icon: 'database' },
  { href: '/lab', label: 'SQL Lab', icon: 'terminal' },
  { href: '/leaderboard', label: 'Competitive Tracks', icon: 'military_tech' },
  { href: '/contributor', label: 'Contributions', icon: 'volunteer_activism' },
  { href: '/docs', label: 'Documentation', icon: 'menu_book' },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <aside className="flex flex-col w-64 h-full bg-surface-container-low border-r border-outline-variant/10">
      {/* Không lặp logo/tên app — đã có trên navbar */}
      {/* Main nav */}
      <div className="px-3 pt-3 space-y-1 shrink-0">
        {MAIN_NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 text-sm font-medium transition-all',
                active
                  ? 'text-on-surface bg-surface-container-highest border-l-2 border-on-surface'
                  : 'text-on-surface-variant hover:bg-surface hover:text-on-surface rounded'
              )}
            >
              <span
                className="material-symbols-outlined text-xl shrink-0"
                style={{
                  fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0",
                }}
              >
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </div>

      {/* New Query CTA */}
      <div className="mt-5 px-4 shrink-0">
        <button
          onClick={() => router.push('/explore')}
          className="w-full py-2 bg-surface-container-highest border border-outline-variant/20 rounded flex items-center justify-center gap-2 text-sm font-medium text-on-surface hover:bg-surface-bright transition-colors"
        >
          <span className="material-symbols-outlined text-lg">add</span>
          New Session
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom section */}
      <div className="p-4 border-t border-outline-variant/10 space-y-2 shrink-0">
        {/* Engine status */}
        <div className="flex items-center justify-between text-[11px] text-on-surface-variant mb-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-on-surface-variant" />
            <span>Ready</span>
          </div>
          <span>142ms</span>
        </div>

        <Link
          href="/settings"
          className="flex items-center gap-3 px-2 py-1.5 text-on-surface-variant hover:text-on-surface cursor-pointer transition-colors rounded"
        >
          <span className="material-symbols-outlined text-lg">account_circle</span>
          <span className="text-xs">User Settings</span>
        </Link>
      </div>
    </aside>
  );
}
