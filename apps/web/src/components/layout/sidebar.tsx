'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth';
import { generateInitials } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  badge?: string | number;
}

const MAIN_NAV: NavItem[] = [
  { href: '/tracks', label: 'Tracks', icon: 'library_books' },
  { href: '/lab', label: 'Workspace', icon: 'terminal' },
  { href: '/dashboard', label: 'My Sessions', icon: 'view_list' },
  { href: '/history', label: 'Query History', icon: 'history' },
  { href: '/leaderboard', label: 'Leaderboard', icon: 'emoji_events' },
];

const BOTTOM_NAV: NavItem[] = [
  { href: '/contributor', label: 'Contributor', icon: 'code' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium font-body transition-all duration-150',
        active
          ? 'bg-primary/15 text-primary'
          : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container'
      )}
    >
      <span
        className={cn(
          'material-symbols-outlined text-xl shrink-0',
          active ? 'text-primary' : 'text-on-surface-variant'
        )}
        style={{ fontVariationSettings: active ? "'FILL' 1" : "'FILL' 0" }}
      >
        {item.icon}
      </span>
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge !== undefined && (
        <span className="text-xs bg-primary/20 text-primary rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
          {item.badge}
        </span>
      )}
    </Link>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { user } = useAuthStore();

  return (
    <aside className="w-56 shrink-0 bg-surface-container-low flex flex-col h-full">
      {/* Main nav */}
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-outline px-3 mb-3">
          Navigation
        </p>
        {MAIN_NAV.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={pathname.startsWith(item.href)}
          />
        ))}

        {/* Schema Explorer */}
        <div className="pt-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-outline px-3 mb-3">
            Workspace
          </p>
          <NavLink
            item={{ href: '/lab/schema', label: 'Schema Explorer', icon: 'schema' }}
            active={pathname === '/lab/schema'}
          />
        </div>
      </div>

      {/* Bottom section */}
      <div className="shrink-0 bg-surface-container">
        <div className="px-3 py-3 space-y-1">
          {BOTTOM_NAV.map((item) => (
            <NavLink
              key={item.href}
              item={item}
              active={pathname.startsWith(item.href)}
            />
          ))}
        </div>

        {/* User info */}
        {user && (
          <div className="px-3 py-3 bg-surface">
            <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-surface-container transition-colors cursor-pointer">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.displayName}
                  className="w-7 h-7 rounded-full object-cover shrink-0"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary to-[#4453a7] flex items-center justify-center text-[#00105b] text-xs font-bold font-headline shrink-0">
                  {generateInitials(user.displayName ?? user.username)}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium text-on-surface truncate leading-tight">
                  {user.displayName ?? user.username}
                </p>
                <p className="text-xs text-on-surface-variant capitalize">
                  {user.role}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
