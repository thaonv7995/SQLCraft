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
}

const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Overview', icon: 'dashboard', exact: true },
  { href: '/admin/users', label: 'User Management', icon: 'group' },
  { href: '/admin/content', label: 'Content Moderation', icon: 'verified_user' },
  { href: '/admin/schema', label: 'Schema Management', icon: 'schema' },
  { href: '/admin/lessons', label: 'Lesson Management', icon: 'menu_book' },
  { href: '/admin/health', label: 'System Health', icon: 'dns' },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex flex-col w-64 h-full bg-[#1c1b1b] border-r border-outline-variant/10">
      {/* Brand */}
      <div className="mb-6 px-6 pt-6 flex items-center gap-3 shrink-0">
        <div className="w-8 h-8 bg-primary rounded-sm flex items-center justify-center shrink-0">
          <span
            className="material-symbols-outlined text-on-primary text-lg"
            style={{ fontVariationSettings: "'FILL' 1" }}
          >
            architecture
          </span>
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tighter text-[#bac3ff] font-headline leading-none">
            Admin Engine
          </h1>
          <p className="text-[10px] text-outline uppercase tracking-widest opacity-70 mt-0.5">
            Unified Infrastructure
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-4 space-y-0.5">
        {ADMIN_NAV.map((item) => {
          const active = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded transition-colors duration-200 text-sm',
                active
                  ? 'text-[#bac3ff] bg-[#353534] border-r-2 border-[#bac3ff] font-bold'
                  : 'text-[#8f909e] hover:text-[#e5e2e1] hover:bg-[#353534]/50'
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

      {/* Bottom */}
      <div className="mt-auto space-y-1 border-t border-outline-variant/10 pt-6 px-4 pb-6 shrink-0">
        <button
          onClick={() => toast.success('Deployment queued')}
          className="w-full mb-4 bg-primary-container text-on-primary-container py-2.5 px-4 rounded font-bold text-sm flex items-center justify-center gap-2 hover:opacity-90 active:scale-[0.99] transition-all"
        >
          <span className="material-symbols-outlined text-sm">rocket_launch</span>
          Deploy Update
        </button>

        <Link
          href="/admin/settings"
          className="flex items-center gap-3 px-3 py-2 rounded text-[#8f909e] hover:text-[#e5e2e1] hover:bg-[#353534]/50 transition-colors text-sm"
        >
          <span className="material-symbols-outlined">settings</span>
          Settings
        </Link>

        <Link
          href="/admin/support"
          className="flex items-center gap-3 px-3 py-2 rounded text-[#8f909e] hover:text-[#e5e2e1] hover:bg-[#353534]/50 transition-colors text-sm"
        >
          <span className="material-symbols-outlined">help_outline</span>
          Support
        </Link>
      </div>
    </aside>
  );
}
