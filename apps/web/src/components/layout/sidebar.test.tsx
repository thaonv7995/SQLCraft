import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Sidebar } from './sidebar';

vi.mock('next/navigation', () => ({
  usePathname: () => '/leaderboard',
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: (selector: (state: { user: null }) => unknown) => selector({ user: null }),
}));

describe('Sidebar', () => {
  it('shows challenges in primary nav and removes submissions', () => {
    render(<Sidebar />);

    expect(screen.getByRole('link', { name: /challenges/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /rankings/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /submissions/i })).not.toBeInTheDocument();
  });
});
