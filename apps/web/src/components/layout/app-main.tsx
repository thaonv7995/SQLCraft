'use client';

import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

/** Cùng điều kiện với MobileAppNav: không có bottom nav trên /lab/[sessionId]. */
function labSessionHidesBottomNav(pathname: string): boolean {
  return /^\/lab\/.+/.test(pathname);
}

export function AppMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? '';
  const hideMobileBottomPadding = labSessionHidesBottomNav(pathname);

  return (
    <main
      className={cn(
        'flex-1 min-w-0 min-h-0 overflow-y-auto bg-surface md:pb-0',
        hideMobileBottomPadding
          ? 'pb-0 max-md:pb-[env(safe-area-inset-bottom)]'
          : 'pb-[calc(3.5rem+env(safe-area-inset-bottom))]',
      )}
    >
      {children}
    </main>
  );
}
