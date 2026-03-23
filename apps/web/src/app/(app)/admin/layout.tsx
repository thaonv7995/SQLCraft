import Link from 'next/link';

const ADMIN_NAV = [
  { href: '/admin', label: 'Overview', icon: 'dashboard' },
  { href: '/admin/users', label: 'Users', icon: 'group' },
  { href: '/admin/content', label: 'Content', icon: 'library_books' },
  { href: '/admin/sessions', label: 'Sessions', icon: 'dns' },
  { href: '/admin/jobs', label: 'Jobs', icon: 'work' },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 min-h-full">
      {/* Admin sub-nav */}
      <aside className="w-48 shrink-0 bg-surface-container-low py-4 px-3 space-y-1 sticky top-0 h-screen">
        <p className="text-xs font-semibold uppercase tracking-wider text-outline px-3 mb-3">
          Admin Panel
        </p>
        {ADMIN_NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors font-body"
          >
            <span className="material-symbols-outlined text-xl">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </aside>

      {/* Content */}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
