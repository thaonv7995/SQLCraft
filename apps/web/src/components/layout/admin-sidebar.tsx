'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  exact?: boolean;
}

const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Overview', icon: 'dashboard', exact: true },
  { href: '/admin/content', label: 'Content', icon: 'quiz' },
  { href: '/admin/databases', label: 'Databases', icon: 'database' },
  { href: '/admin/users', label: 'Users', icon: 'group' },
  { href: '/admin/rankings', label: 'Rankings', icon: 'leaderboard' },
  { href: '/admin/system', label: 'System', icon: 'dns' },
];

export function AdminSidebar() {
  const pathname = usePathname();

  const isActiveRoute = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="flex flex-col w-64 h-full bg-surface-container-low border-r border-outline-variant/10">
      {/* Nav */}
      <nav className="flex-1 px-4 py-6 space-y-0.5">
        {ADMIN_NAV.map((item) => {
          const active = isActiveRoute(item.href, item.exact);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded transition-colors duration-200 text-sm',
                active
                  ? 'text-on-surface bg-surface-container-highest border-l-2 border-on-surface font-semibold'
                  : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/50'
              )}
            >
              <span
                className="material-symbols-outlined shrink-0"
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
      </nav>
    </aside>
  );
}
