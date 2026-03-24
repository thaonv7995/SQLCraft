'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import toast from 'react-hot-toast';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  exact?: boolean;
  children?: Array<{
    href: string;
    label: string;
  }>;
}

const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Overview', icon: 'dashboard', exact: true },
  { href: '/admin/users', label: 'User Management', icon: 'group' },
  { href: '/admin/content', label: 'Content Moderation', icon: 'verified_user' },
  { href: '/admin/schema', label: 'Schema Management', icon: 'schema' },
  { href: '/admin/lessons', label: 'Lesson Management', icon: 'menu_book' },
  {
    href: '/admin/health',
    label: 'System Health',
    icon: 'dns',
    children: [{ href: '/admin/health/logs', label: 'System Logs' }],
  },
];

export function AdminSidebar() {
  const pathname = usePathname();

  const isActiveRoute = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <aside className="flex flex-col w-64 h-full bg-surface-container-low border-r border-outline-variant/10">
      {/* Brand */}
      <div className="mb-6 px-6 pt-6 flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 bg-surface-container-high border border-outline-variant rounded-md flex items-center justify-center shrink-0">
          <span
            className="material-symbols-outlined text-on-surface text-lg"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            architecture
          </span>
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-on-surface font-headline leading-none">
            Admin
          </h1>
          <p className="text-[10px] text-on-surface-variant mt-0.5">Console</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-4 space-y-0.5">
        {ADMIN_NAV.map((item) => {
          const childActive = item.children?.some((child) => isActiveRoute(child.href)) ?? false;
          const active = isActiveRoute(item.href, item.exact) || childActive;

          return (
            <div key={item.href} className="space-y-1">
              <Link
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

              {childActive && item.children ? (
                <div className="pl-10 space-y-1">
                  {item.children.map((child) => {
                    const childIsActive = isActiveRoute(child.href);

                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={cn(
                          'flex items-center gap-3 px-3 py-1.5 rounded text-xs transition-colors duration-200',
                          childIsActive
                            ? 'text-on-surface font-semibold'
                            : 'text-on-surface-variant hover:text-on-surface'
                        )}
                      >
                        <span
                          className={cn(
                            'w-1.5 h-1.5 rounded-full',
                            childIsActive ? 'bg-on-surface' : 'bg-on-surface-variant'
                          )}
                        />
                        {child.label}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      {/* Bottom */}
      <div className="mt-auto space-y-1 border-t border-outline-variant/10 pt-6 px-4 pb-6 shrink-0">
        <button
          onClick={() => toast.success('Deployment queued')}
          className="w-full mb-4 border border-outline-variant bg-primary text-on-primary py-2.5 px-4 rounded font-semibold text-sm flex items-center justify-center gap-2 hover:brightness-110 active:scale-[0.99] transition-all"
        >
          <span className="material-symbols-outlined text-sm">rocket_launch</span>
          Deploy Update
        </button>

        <Link
          href="/admin/settings"
          className="flex items-center gap-3 px-3 py-2 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/50 transition-colors text-sm"
        >
          <span className="material-symbols-outlined">settings</span>
          Settings
        </Link>

        <Link
          href="/admin/support"
          className="flex items-center gap-3 px-3 py-2 rounded text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/50 transition-colors text-sm"
        >
          <span className="material-symbols-outlined">help_outline</span>
          Support
        </Link>
      </div>
    </aside>
  );
}
