import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminContentPage from './page';

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  tracksApi: {
    list: vi.fn(),
  },
  challengesApi: {
    listReviewQueue: vi.fn(),
    publishVersion: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: mocks.toastSuccess,
  },
}));

vi.mock('@/lib/api', () => ({
  tracksApi: mocks.tracksApi,
  challengesApi: mocks.challengesApi,
}));

function renderAdminContentPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AdminContentPage />
    </QueryClientProvider>,
  );
}

describe('AdminContentPage', () => {
  beforeEach(() => {
    mocks.tracksApi.list.mockResolvedValue({
      items: [
        {
          id: 'track-1',
          title: 'SQL Fundamentals',
          slug: 'sql-fundamentals',
          description: 'Track description',
          difficulty: 'beginner',
          lessonCount: 3,
          createdAt: '2026-03-20T00:00:00.000Z',
          isPublished: true,
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
      totalPages: 1,
    });

    mocks.challengesApi.listReviewQueue.mockResolvedValue([
      {
        id: 'challenge-1',
        lessonId: 'lesson-1',
        lessonSlug: 'filtering',
        lessonTitle: 'Filtering',
        trackId: 'track-1',
        trackSlug: 'sql-fundamentals',
        trackTitle: 'SQL Fundamentals',
        slug: 'filter-active-users',
        title: 'Filter active users',
        description: 'Return active users only.',
        difficulty: 'intermediate',
        sortOrder: 1,
        status: 'draft',
        points: 200,
        publishedVersionId: null,
        latestVersionId: 'challenge-version-1',
        latestVersionNo: 1,
        validatorType: 'result_set',
        createdBy: {
          id: 'user-2',
          username: 'alice',
          displayName: 'Alice',
        },
        updatedAt: '2026-03-24T00:00:00.000Z',
        createdAt: '2026-03-20T00:00:00.000Z',
      },
    ]);

    mocks.challengesApi.publishVersion.mockResolvedValue({
      id: 'challenge-version-1',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('shows the challenge review queue and publishes a selected draft', async () => {
    const user = userEvent.setup();

    renderAdminContentPage();

    await user.click(screen.getByRole('button', { name: 'Challenges' }));

    expect(await screen.findByText('Filter active users')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /publish v1/i }));

    await waitFor(() => {
      expect(mocks.challengesApi.publishVersion).toHaveBeenCalledWith('challenge-version-1');
    });
  });
});
