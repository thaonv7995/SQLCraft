import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LeaderboardPage from './page';

const mocks = vi.hoisted(() => ({
  challengesApi: {
    listPublished: vi.fn(),
    getLeaderboard: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  challengesApi: mocks.challengesApi,
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

    mocks.challengesApi.getLeaderboard.mockImplementation(async (challengeVersionId: string) => {
      if (challengeVersionId === 'challenge-version-2') {
        return [
          {
            rank: 1,
            userId: 'user-2',
            username: 'bob',
            displayName: 'Bob',
            avatarUrl: null,
            bestScore: 300,
            attemptsCount: 2,
            passedAttempts: 2,
            lastSubmittedAt: '2026-03-24T00:10:00.000Z',
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
          bestScore: 200,
          attemptsCount: 1,
          passedAttempts: 1,
          lastSubmittedAt: '2026-03-24T00:05:00.000Z',
        },
      ];
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the published challenge catalog and switches leaderboard data when a challenge is selected', async () => {
    const user = userEvent.setup();

    renderLeaderboardPage();

    expect(await screen.findByRole('heading', { name: /challenge leaderboard/i })).toBeInTheDocument();
    expect(await screen.findByText('Filter active users')).toBeInTheDocument();
    expect(await screen.findByText('Alice')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /optimize user lookup/i }));

    await waitFor(() => {
      expect(mocks.challengesApi.getLeaderboard).toHaveBeenCalledWith('challenge-version-2', 10);
    });

    expect(await screen.findByText('Bob')).toBeInTheDocument();
  });
});
