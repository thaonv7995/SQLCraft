import { Navbar } from '@/components/layout/navbar';
import { Sidebar } from '@/components/layout/sidebar';
import { MobileAppNav } from '@/components/layout/mobile-app-nav';
import { AuthGuard } from '@/components/auth-guard';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="min-h-screen bg-surface flex flex-col">
        {/* Top navbar */}
        <Navbar />

        {/* Body: sidebar + content */}
        <div className="flex flex-1 pt-14">
          {/* Sidebar — hidden on mobile */}
          <div className="hidden md:flex flex-col h-[calc(100vh-3.5rem)] sticky top-14 w-60 lg:w-64 shrink-0">
            <Sidebar />
          </div>

          {/* Main content — padding bottom on mobile for bottom nav */}
          <main className="flex-1 min-w-0 overflow-y-auto bg-surface pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
            {children}
          </main>
        </div>

        <MobileAppNav />
      </div>
    </AuthGuard>
  );
}
