import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ContributorPage from './page';

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  tracksApi: {
    list: vi.fn(),
    get: vi.fn(),
  },
  challengesApi: {
    listMine: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: {
      id: 'user-1',
      username: 'alice',
      displayName: 'Alice',
    },
  }),
}));

vi.mock('@/lib/api', () => ({
  tracksApi: mocks.tracksApi,
  challengesApi: mocks.challengesApi,
}));

function renderContributorPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ContributorPage />
    </QueryClientProvider>,
  );
}

describe('ContributorPage', () => {
  beforeEach(() => {
    mocks.tracksApi.list.mockResolvedValue({
      items: [
        {
          id: 'track-1',
          title: 'SQL Fundamentals',
          slug: 'sql-fundamentals',
          description: 'Track description',
          difficulty: 'beginner',
          lessonCount: 1,
        },
      ],
      total: 1,
      page: 1,
      limit: 50,
      totalPages: 1,
    });

    mocks.tracksApi.get.mockResolvedValue({
      id: 'track-1',
      title: 'SQL Fundamentals',
      slug: 'sql-fundamentals',
      description: 'Track description',
      difficulty: 'beginner',
      lessonCount: 1,
      lessons: [
        {
          id: 'lesson-1',
          trackId: 'track-1',
          title: 'Filtering',
          slug: 'filtering',
          description: 'Filter rows',
          difficulty: 'beginner',
          estimatedMinutes: 10,
          sortOrder: 1,
          publishedVersionId: 'lesson-version-1',
        },
      ],
    });

    mocks.challengesApi.listMine.mockResolvedValue([
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
        updatedAt: '2026-03-24T00:00:00.000Z',
        createdAt: '2026-03-20T00:00:00.000Z',
      },
    ]);

    mocks.challengesApi.create.mockResolvedValue({
      challenge: { id: 'challenge-2' },
      version: { id: 'challenge-version-2' },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists the user challenge drafts and creates a new draft from the contributor form', async () => {
    const user = userEvent.setup();

    renderContributorPage();

    expect(await screen.findByRole('heading', { name: /build challenge drafts/i })).toBeInTheDocument();
    expect(await screen.findByText('Filter active users')).toBeInTheDocument();
    expect(await screen.findByRole('option', { name: 'SQL Fundamentals / Filtering' })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Lesson'), 'lesson-1');
    await user.type(screen.getByLabelText('Title'), 'Index active users');
    await user.clear(screen.getByLabelText('Slug'));
    await user.type(screen.getByLabelText('Slug'), 'index-active-users');
    await user.clear(screen.getByLabelText('Points'));
    await user.type(screen.getByLabelText('Points'), '200');
    await user.type(
      screen.getByLabelText('Problem Statement'),
      'Return active users quickly and reward indexed solutions.',
    );

    await user.click(screen.getByRole('button', { name: /create draft/i }));

    await waitFor(() => {
      expect(mocks.challengesApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          lessonId: 'lesson-1',
          title: 'Index active users',
          slug: 'index-active-users',
          points: 200,
          problemStatement: 'Return active users quickly and reward indexed solutions.',
        }),
      );
    });
  });
});
