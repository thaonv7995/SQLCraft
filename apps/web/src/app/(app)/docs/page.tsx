import Link from 'next/link';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Hướng dẫn sử dụng',
  description:
    'Hướng dẫn dùng SQLCraft: các màn hình, luồng luyện SQL, Lab, challenges và phím tắt.',
};

const TOC = [
  { href: '#tong-quan', label: 'Tổng quan' },
  { href: '#luong-su-dung', label: 'Luồng sử dụng' },
  { href: '#man-hinh', label: 'Các màn hình' },
  { href: '#khai-niem', label: 'Khái niệm' },
  { href: '#phim-tat', label: 'Phím tắt' },
] as const;

const APP_SECTIONS = [
  {
    title: 'Dashboard',
    description:
      'Tổng quan hoạt động: thống kê phiên đang chạy, số truy vấn (7 ngày gần nhất), challenge đã hoàn thành, gợi ý database nổi bật và truy vấn gần đây.',
    href: '/dashboard',
    icon: 'dashboard',
  },
  {
    title: 'Databases (Explorer)',
    description:
      'Danh sách bộ dữ liệu mẫu: đọc mô tả, quy mô (số dòng), cấu trúc bảng. Chọn một bộ để xem chi tiết và bắt đầu phiên luyện tập.',
    href: '/explore',
    icon: 'database',
  },
  {
    title: 'SQL Lab',
    description:
      'Danh sách phiên đang hoặc đã tạo; mở một phiên để soạn SQL, chạy câu lệnh, xem kế hoạch thực thi, lịch sử và (khi có) so sánh kết quả.',
    href: '/lab',
    icon: 'terminal',
  },
  {
    title: 'Challenges & Leaderboard',
    description:
      'Bảng xếp hạng và hub challenge: luyện bài có chấm điểm, xem submission và tiến độ cộng đồng.',
    href: '/leaderboard',
    icon: 'target',
  },
  {
    title: 'Query history',
    description: 'Toàn bộ truy vấn đã chạy qua các phiên, có thể lọc và xem lại SQL cùng kết quả tóm tắt.',
    href: '/history',
    icon: 'history',
  },
  {
    title: 'Profile & Settings',
    description:
      'Hồ sơ người dùng, thống kê cá nhân; cài đặt tài khoản (Settings) từ menu sidebar.',
    href: '/profile',
    icon: 'person',
  },
] as const;

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-outline-variant/30 bg-surface-container-high px-2 py-0.5 font-mono text-xs text-on-surface">
      {children}
    </kbd>
  );
}

export default function DocsPage() {
  return (
    <div className="page-shell-narrow page-stack">
      <header className="space-y-3">
        <h1 className="page-title-lg">Hướng dẫn sử dụng</h1>
        <p className="page-lead max-w-2xl">
          SQLCraft giúp bạn <strong className="font-semibold text-on-surface">luyện SQL</strong> trên
          các bộ dữ liệu mẫu trong <strong className="font-semibold text-on-surface">môi trường riêng</strong>{' '}
          cho từng phiên: soạn câu lệnh, xem kết quả, phân tích truy vấn và tham gia challenge. Trang
          này chỉ dành cho <strong className="font-semibold text-on-surface">người dùng ứng dụng</strong>
          — cách điều hướng và thao tác trong từng màn hình.
        </p>
        <nav
          aria-label="Mục lục"
          className="flex flex-wrap gap-2 border-b border-outline-variant/10 pb-4"
        >
          {TOC.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-full border border-outline-variant/20 bg-surface-container-low px-3 py-1 text-xs font-medium text-on-surface-variant transition-colors hover:border-outline-variant/40 hover:text-on-surface"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>

      <section id="tong-quan" className="scroll-mt-24 section-card card-padding">
        <h2 className="page-section-title">SQLCraft là gì?</h2>
        <ul className="mt-4 list-inside list-disc space-y-2 text-sm leading-relaxed text-on-surface-variant">
          <li>
            <span className="text-on-surface">Soạn và chạy SQL trong trình duyệt</span> — mỗi phiên có
            database tách biệt; bạn xem được một phần kết quả (đủ để học) và thời gian chạy câu lệnh.
          </li>
          <li>
            <span className="text-on-surface">Nhiều mức dữ liệu</span> — cùng một bộ bảng có thể chọn
            quy mô nhỏ hoặc lớn hơn tùy bài tập; số dòng hiển thị trên màn hình phản ánh đúng bộ dữ
            liệu bạn đang dùng.
          </li>
          <li>
            <span className="text-on-surface">Challenges & leaderboard</span> — bài tập có đánh giá,
            điểm và bảng xếp hạng để theo dõi tiến độ.
          </li>
        </ul>
      </section>

      <section id="luong-su-dung" className="scroll-mt-24 section-card card-padding">
        <h2 className="page-section-title">Luồng sử dụng điển hình</h2>
        <ol className="mt-4 list-inside list-decimal space-y-3 text-sm leading-relaxed text-on-surface-variant">
          <li>
            <span className="text-on-surface">Đăng nhập</span> — bạn cần tài khoản để vào các màn hình
            luyện tập và lưu tiến độ.
          </li>
          <li>
            <span className="text-on-surface">Mở Databases</span> — chọn catalog (ví dụ ecommerce),
            đọc mô tả và schema.
          </li>
          <li>
            <span className="text-on-surface">Bắt đầu phiên</span> — chọn mức dữ liệu (nếu có nhiều lựa
            chọn), bấm khởi chạy; ứng dụng mở{' '}
            <Link href="/lab" className="font-medium text-primary underline-offset-2 hover:underline">
              SQL Lab
            </Link>{' '}
            cho phiên vừa tạo.
          </li>
          <li>
            <span className="text-on-surface">Viết và chạy SQL</span> — trong Lab, dùng ô soạn thảo và
            phím tắt để chạy câu lệnh; xem kế hoạch thực thi và lịch sử trong cùng phiên.
          </li>
          <li>
            <span className="text-on-surface">Kết thúc phiên</span> — khi hết thời gian hoặc bạn chủ
            động kết thúc, môi trường của phiên đó sẽ đóng và dữ liệu tạm không còn truy cập được.
          </li>
          <li>
            <span className="text-on-surface">Challenges</span> — từ leaderboard mở từng challenge,
            nộp lời giải theo hướng dẫn từng bài.
          </li>
        </ol>
      </section>

      <section id="man-hinh" className="scroll-mt-24 space-y-4">
        <h2 className="page-section-title px-1">Các màn hình trong ứng dụng</h2>
        <p className="px-1 text-sm text-on-surface-variant">
          Điều hướng chính nằm ở sidebar (desktop) hoặc thanh dưới (mobile). Admin có thêm mục{' '}
          <strong className="text-on-surface">Admin Panel</strong> khi tài khoản có quyền.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          {APP_SECTIONS.map((item) => (
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
                  <h3 className="page-section-title text-base">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
                    {item.description}
                  </p>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-on-surface">
                    Mở trang
                    <span className="material-symbols-outlined text-base">arrow_forward</span>
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
        <p className="px-1 text-sm text-on-surface-variant">
          Trang <Link href="/submissions" className="font-medium text-primary underline-offset-2 hover:underline">Submissions</Link> tổng hợp bài nộp challenge (nếu bạn đã tham gia).
        </p>
      </section>

      <section id="khai-niem" className="scroll-mt-24 section-card card-padding">
        <h2 className="page-section-title">Khái niệm quan trọng</h2>
        <dl className="mt-4 space-y-4 text-sm text-on-surface-variant">
          <div>
            <dt className="font-semibold text-on-surface">Phiên Lab</dt>
            <dd className="mt-1 leading-relaxed">
              Một lần “làm việc” gắn với một database riêng, tạm thời. Thường mỗi lần bạn bắt đầu từ
              trang Databases là một phiên mới; bạn cũng có thể tiếp tục phiên chưa đóng từ danh sách
              trong SQL Lab.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-on-surface">Thời hạn phiên</dt>
            <dd className="mt-1 leading-relaxed">
              Phiên có giới hạn thời gian. Khi bạn còn làm việc trong Lab, thời hạn có thể được gia hạn
              nhẹ. Hết hạn hoặc sau khi đóng phiên, bạn không còn mở lại cùng dữ liệu đó.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-on-surface">Số liệu trên Dashboard và Profile</dt>
            <dd className="mt-1 leading-relaxed">
              Mục <strong className="text-on-surface">Queries</strong> thường đếm các câu lệnh bạn đã
              chạy trong <strong className="text-on-surface">7 ngày gần nhất</strong>, để phản ánh
              mức độ luyện tập gần đây — không phải tổng từ trước đến nay. Số challenge hoàn thành có
              thể hiển thị theo tổng đã làm được.
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-on-surface">Kết quả và kế hoạch thực thi</dt>
            <dd className="mt-1 leading-relaxed">
              Mỗi lần chạy SQL, bảng kết quả chỉ hiển thị một phần các dòng (đủ để đọc và kiểm tra).
              Phần kế hoạch thực thi giúp bạn hiểu cách hệ quản trị cơ sở dữ liệu xử lý câu lệnh (hữu
              ích khi học tối ưu truy vấn).
            </dd>
          </div>
        </dl>
      </section>

      <section id="phim-tat" className="scroll-mt-24 section-card card-padding">
        <h2 className="page-section-title">Phím tắt trong SQL Lab</h2>
        <ul className="mt-4 space-y-3 text-sm text-on-surface-variant">
          <li className="flex flex-wrap items-center gap-2">
            <Kbd>Ctrl</Kbd>
            <span>+</span>
            <Kbd>Enter</Kbd>
            <span className="text-on-surface-variant">
              — chạy truy vấn đang soạn{' '}
              <span className="text-on-surface">(macOS: ⌘ + Enter)</span>
            </span>
          </li>
        </ul>
        <p className="mt-4 text-xs text-outline">
          Gợi ý tương tự cũng hiển thị ngay dưới ô editor trong Lab.
        </p>
      </section>

      <div className="rounded-xl border border-dashed border-outline-variant/25 bg-surface-container-low/50 p-5 text-sm text-on-surface-variant">
        <p>
          Cần chỉnh tài khoản hoặc theme? Mở{' '}
          <Link href="/settings" className="font-medium text-on-surface underline-offset-2 hover:underline">
            User Settings
          </Link>
          . Hỗ trợ vận hành: liên hệ quản trị qua kênh nội bộ của tổ chức bạn.
        </p>
      </div>
    </div>
  );
}
