import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Documentation',
  description: 'Hướng dẫn sử dụng SQLCraft: luyện SQL, challenge hub, top users và phím tắt.',
};

const SECTIONS = [
  {
    title: 'Bắt đầu',
    description: 'Tổng quan workspace: dashboard, streak và điểm từ các challenge SQL.',
    href: '/dashboard',
    icon: 'rocket_launch',
  },
  {
    title: 'Databases',
    description: 'Khám phá catalog sandbox, schema và mối quan hệ bảng trước khi viết truy vấn.',
    href: '/explore',
    icon: 'database',
  },
  {
    title: 'SQL Lab',
    description: 'Soạn SQL, chạy kết quả, xem plan và lịch sử trong một phiên làm việc.',
    href: '/lab',
    icon: 'terminal',
  },
  {
    title: 'Challenges',
    description: 'Mở challenge hub, xem top users theo điểm, rồi đi vào từng bài để add submission.',
    href: '/leaderboard',
    icon: 'target',
  },
] as const;

export default function DocsPage() {
  return (
    <div className="page-shell-narrow page-stack">
      <div>
        <h1 className="page-title-lg">Documentation</h1>
        <p className="page-lead mt-2 max-w-2xl">
          SQLCraft là môi trường luyện SQL trên dataset sandbox. Trang này tóm tắt luồng
          chính; chi tiết kiến trúc và API nằm trong repo (thư mục <code className="rounded bg-surface-container-high px-1.5 py-0.5 font-mono text-sm">docs/</code>).
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="section-card card-padding group transition-colors hover:border-outline-variant/25"
          >
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined shrink-0 text-on-surface-variant group-hover:text-on-surface">
                {item.icon}
              </span>
              <div>
                <h2 className="page-section-title">{item.title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">{item.description}</p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-on-surface">
                  Mở trang
                  <span className="material-symbols-outlined text-base">arrow_forward</span>
                </span>
              </div>
            </div>
          </Link>
        ))}
      </div>

      <div className="section-card card-padding">
        <h2 className="page-section-title">Phím tắt trong SQL Lab</h2>
        <ul className="mt-4 space-y-2 text-sm text-on-surface-variant">
          <li className="flex flex-wrap items-center gap-2">
            <kbd className="rounded border border-outline-variant/30 bg-surface-container-high px-2 py-0.5 font-mono text-xs text-on-surface">
              Ctrl
            </kbd>
            <span>+</span>
            <kbd className="rounded border border-outline-variant/30 bg-surface-container-high px-2 py-0.5 font-mono text-xs text-on-surface">
              Enter
            </kbd>
            <span className="text-on-surface-variant">— chạy truy vấn (macOS: Cmd+Enter)</span>
          </li>
        </ul>
      </div>

      <div className="rounded-xl border border-dashed border-outline-variant/25 bg-surface-container-low/50 p-5 text-sm text-on-surface-variant">
        <p>
          Cần quay lại challenge hub? Mở{' '}
          <Link href="/leaderboard" className="font-medium text-on-surface underline-offset-2 hover:underline">
            Challenges
          </Link>
          {' '}hoặc liên hệ quản trị qua menu tài khoản nếu bạn cần hỗ trợ hệ thống.
        </p>
      </div>
    </div>
  );
}
