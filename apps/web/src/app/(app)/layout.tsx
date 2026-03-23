import { Navbar } from '@/components/layout/navbar';
import { Sidebar } from '@/components/layout/sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-surface flex flex-col">
      {/* Top navbar */}
      <Navbar />

      {/* Body: sidebar + content */}
      <div className="flex flex-1 pt-14">
        {/* Sidebar — hidden on mobile */}
        <div className="hidden md:flex flex-col h-[calc(100vh-3.5rem)] sticky top-14 w-56 shrink-0">
          <Sidebar />
        </div>

        {/* Main content */}
        <main className="flex-1 min-w-0 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
