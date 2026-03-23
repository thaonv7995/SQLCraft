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
  { href: '/explore', label: 'Databases', icon: 'database' },
  { href: '/lab', label: 'SQL Lab', icon: 'terminal' },
  { href: '/leaderboard', label: 'Competitive Tracks', icon: 'military_tech' },
  { href: '/contributor', label: 'Contributions', icon: 'volunteer_activism' },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <aside className="flex flex-col w-64 h-full bg-[#1c1b1b] border-r border-outline-variant/10">
      {/* Brand */}
      <div className="p-4 flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 rounded bg-tertiary/10 flex items-center justify-center shrink-0">
          <span
            className="material-symbols-outlined text-tertiary"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            database
          </span>
        </div>
        <div>
          <h2 className="text-lg font-black text-[#44d8f1] leading-none font-headline">
            Learner Lab
          </h2>
          <p className="text-[10px] text-outline uppercase tracking-wider mt-1">v2.4.0-stable</p>
        </div>
      </div>

      {/* Main nav */}
      <div className="px-3 mt-2 space-y-0.5 shrink-0">
        {MAIN_NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2 text-sm font-medium transition-all',
                active
                  ? 'text-[#e5e2e1] bg-[#353534] border-l-4 border-[#bac3ff]'
                  : 'text-[#8f909e] hover:bg-[#131313] hover:text-[#e5e2e1] rounded'
              )}
            >
              <span
                className="material-symbols-outlined text-xl shrink-0"
                style={{
                  fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0",
                  color: active ? '#bac3ff' : undefined,
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
      <div className="mt-6 px-4 shrink-0">
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
        <div className="flex items-center justify-between text-[11px] text-outline mb-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-secondary shadow-[0_0_8px_rgba(102,217,204,0.4)]" />
            <span>Engine Ready</span>
          </div>
          <span>142ms</span>
        </div>

        <Link
          href="/settings"
          className="flex items-center gap-3 px-2 py-1.5 text-[#8f909e] hover:text-[#e5e2e1] cursor-pointer transition-colors rounded"
        >
          <span className="material-symbols-outlined text-lg">account_circle</span>
          <span className="text-xs">User Settings</span>
        </Link>

        <Link
          href="/dashboard"
          className="flex items-center gap-3 px-2 py-1.5 text-[#8f909e] hover:text-[#e5e2e1] cursor-pointer transition-colors rounded"
        >
          <span className="material-symbols-outlined text-lg">cloud_done</span>
          <span className="text-xs">Cloud Status</span>
        </Link>
      </div>
    </aside>
  );
}
