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
  { href: '/lab', label: 'SQL Lab', icon: 'terminal' },
  { href: '/dashboard', label: 'My Sessions', icon: 'view_list' },
  { href: '/history', label: 'Query History', icon: 'history' },
  { href: '/leaderboard', label: 'Leaderboard', icon: 'military_tech' },
];

const BOTTOM_NAV: NavItem[] = [
  { href: '/contributor', label: 'Contributor', icon: 'volunteer_activism' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      className={cn(
        'flex items-center gap-3 px-4 py-2.5 text-sm font-medium font-body transition-all duration-150',
        active
          ? 'bg-surface-container-highest text-primary border-l-2 border-primary'
          : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/50 rounded'
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
        <span className="text-[10px] bg-primary/20 text-primary rounded-full px-1.5 py-0.5 min-w-[18px] text-center font-mono">
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
      {/* Brand */}
      <div className="px-5 py-4 flex items-center gap-3">
        <div className="w-8 h-8 bg-surface-container-highest rounded flex items-center justify-center shrink-0">
          <span
            className="material-symbols-outlined text-tertiary text-lg"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            database
          </span>
        </div>
        <div>
          <h2 className="text-base font-bold text-tertiary leading-tight font-headline">
            Learner Lab
          </h2>
          <p className="text-[9px] text-outline uppercase tracking-widest mt-0.5">v2.4.0-stable</p>
        </div>
      </div>

      {/* Main nav */}
      <div className="flex-1 overflow-y-auto py-2 space-y-0.5">
        <p className="text-[9px] font-bold uppercase tracking-widest text-outline px-5 py-2 mt-2">
          Navigation
        </p>
        {MAIN_NAV.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            active={pathname.startsWith(item.href)}
          />
        ))}

        {/* Workspace section */}
        <p className="text-[9px] font-bold uppercase tracking-widest text-outline px-5 py-2 mt-4">
          Workspace
        </p>
        <NavLink
          item={{ href: '/lab/schema', label: 'Schema Explorer', icon: 'schema' }}
          active={pathname === '/lab/schema'}
        />
      </div>

      {/* Bottom section */}
      <div className="shrink-0">
        <div className="py-2 space-y-0.5">
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
            <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-surface-container-high/50 transition-colors cursor-pointer">
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
                <p className="text-xs text-outline capitalize">{user.role}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
