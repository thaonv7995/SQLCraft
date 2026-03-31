import { AppMain } from '@/components/layout/app-main';
import { Navbar } from '@/components/layout/navbar';
import { Sidebar } from '@/components/layout/sidebar';
import { MobileAppNav } from '@/components/layout/mobile-app-nav';
import { AuthGuard } from '@/components/auth-guard';
import { AuthProfileSync } from '@/components/auth-profile-sync';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="h-screen bg-surface flex flex-col overflow-hidden">
        <AuthProfileSync />
        {/* Top navbar */}
        <Navbar />

        {/* Body: sidebar + content */}
        <div className="flex flex-1 min-h-0 pt-14">
          {/* Sidebar — hidden on mobile */}
          <div className="hidden md:flex flex-col h-[calc(100vh-3.5rem)] sticky top-14 w-60 lg:w-64 shrink-0">
            <Sidebar />
          </div>

          {/* Main — pb mobile chỉ khi có bottom nav (trùng logic MobileAppNav) */}
          <AppMain>{children}</AppMain>
        </div>

        <MobileAppNav />
      </div>
    </AuthGuard>
  );
}
