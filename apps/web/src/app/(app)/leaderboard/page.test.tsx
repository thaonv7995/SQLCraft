import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LeaderboardPage from './page';

const mocks = vi.hoisted(() => ({
  challengesApi: {
    listPublished: vi.fn(),
  },
  leaderboardApi: {
    get: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  challengesApi: mocks.challengesApi,
  leaderboardApi: mocks.leaderboardApi,
}));

function renderLeaderboardPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LeaderboardPage />
    </QueryClientProvider>,
  );
}

describe('LeaderboardPage', () => {
  beforeEach(() => {
    mocks.challengesApi.listPublished.mockResolvedValue([
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
        status: 'published',
        points: 200,
        publishedVersionId: 'challenge-version-1',
        latestVersionId: 'challenge-version-1',
        latestVersionNo: 1,
        validatorType: 'result_set',
        updatedAt: '2026-03-24T00:00:00.000Z',
        createdAt: '2026-03-20T00:00:00.000Z',
      },
      {
        id: 'challenge-2',
        lessonId: 'lesson-2',
        lessonSlug: 'joins',
        lessonTitle: 'Joins',
        trackId: 'track-1',
        trackSlug: 'sql-fundamentals',
        trackTitle: 'SQL Fundamentals',
        slug: 'optimize-user-lookup',
        title: 'Optimize user lookup',
        description: 'Tune an indexed lookup query.',
        difficulty: 'advanced',
        sortOrder: 2,
        status: 'published',
        points: 300,
        publishedVersionId: 'challenge-version-2',
        latestVersionId: 'challenge-version-2',
        latestVersionNo: 2,
        validatorType: 'result_set',
        updatedAt: '2026-03-24T00:00:00.000Z',
        createdAt: '2026-03-20T00:00:00.000Z',
      },
    ]);

    mocks.leaderboardApi.get.mockImplementation(
      async (period: 'weekly' | 'monthly' | 'alltime') => {
        if (period === 'monthly') {
          return [
            {
              rank: 1,
              userId: 'user-2',
              username: 'bob',
              displayName: 'Bob',
              avatarUrl: null,
              points: 450,
              challengesCompleted: 4,
              streak: 6,
            },
          ];
        }

        return [
          {
            rank: 1,
            userId: 'user-1',
            username: 'alice',
            displayName: 'Alice',
            avatarUrl: null,
            points: 820,
            challengesCompleted: 7,
            streak: 12,
          },
          {
            rank: 2,
            userId: 'user-3',
            username: 'carol',
            displayName: 'Carol',
            avatarUrl: null,
            points: 710,
            challengesCompleted: 6,
            streak: 8,
          },
        ];
      },
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the challenges hub with top users and challenge submission links', async () => {
    const user = userEvent.setup();

    renderLeaderboardPage();

    expect(await screen.findByRole('heading', { name: /challenges/i })).toBeInTheDocument();
    expect(await screen.findByText(/pick a challenge, add a submission, and compare against the top users by point/i)).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: /top users/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.leaderboardApi.get).toHaveBeenCalledWith('alltime', 25);
    });

    expect(await screen.findByText('Alice')).toBeInTheDocument();

    const arenaLink = await screen.findByRole('link', {
      name: /add submission for filter active users/i,
    });
    expect(arenaLink).toHaveAttribute(
      'href',
      '/tracks/track-1/lessons/lesson-1/challenges/challenge-1',
    );

    await user.click(screen.getByRole('button', { name: /monthly/i }));

    await waitFor(() => {
      expect(mocks.leaderboardApi.get).toHaveBeenCalledWith('monthly', 25);
    });

    expect(await screen.findByText('Bob')).toBeInTheDocument();
  });
});
