import { Navbar } from '@/components/layout/navbar';
import { AdminSidebar } from '@/components/layout/admin-sidebar';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface flex flex-col">
      <Navbar />

      <div className="flex flex-1 pt-14">
        {/* Admin sidebar — hidden on mobile */}
        <div className="hidden md:flex flex-col h-[calc(100vh-3.5rem)] sticky top-14 w-64 shrink-0">
          <AdminSidebar />
        </div>

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
