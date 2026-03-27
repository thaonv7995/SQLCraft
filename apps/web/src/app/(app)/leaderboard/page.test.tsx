import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LeaderboardPage from './page-client';
import type { ClientPageProps } from '@/lib/page-props';
import { useAuthStore } from '@/stores/auth';

const routerPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPush }),
}));

const mocks = vi.hoisted(() => ({
  challengesApi: {
    listPublished: vi.fn(),
    listAttempts: vi.fn(),
  },
  leaderboardApi: {
    get: vi.fn(),
  },
  lessonsApi: {
    get: vi.fn(),
    getVersion: vi.fn(),
  },
  sessionsApi: {
    create: vi.fn(),
  },
}));

vi.mock('@/lib/api', () => ({
  challengesApi: mocks.challengesApi,
  leaderboardApi: mocks.leaderboardApi,
  lessonsApi: mocks.lessonsApi,
  sessionsApi: mocks.sessionsApi,
}));

async function renderLeaderboardPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const pageProps: ClientPageProps = {
    params: {},
    searchParams: {},
  };

  let result: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <QueryClientProvider client={queryClient}>
        <LeaderboardPage {...pageProps} />
      </QueryClientProvider>,
    );
  });
  return result!;
}

describe('LeaderboardPage', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: {
        id: 'user-1',
        username: 'alice',
        email: 'alice@example.com',
        displayName: 'Alice',
        avatarUrl: null,
        role: 'user',
        roles: ['user'],
        status: 'active',
        bio: null,
        createdAt: '2026-03-20T00:00:00.000Z',
        lastLoginAt: '2026-03-24T00:00:00.000Z',
        updatedAt: '2026-03-24T00:00:00.000Z',
        stats: {
          activeSessions: 0,
          completedChallenges: 0,
          queriesRun: 0,
          currentStreak: 0,
          totalPoints: 0,
        },
      },
      tokens: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresIn: 3600,
      },
    });

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
        datasetScale: 'small',
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
        datasetScale: 'small',
        publishedVersionId: 'challenge-version-2',
        latestVersionId: 'challenge-version-2',
        latestVersionNo: 2,
        validatorType: 'result_set',
        updatedAt: '2026-03-24T00:00:00.000Z',
        createdAt: '2026-03-20T00:00:00.000Z',
      },
    ]);

    mocks.challengesApi.listAttempts.mockImplementation(async (challengeVersionId: string) => {
      if (challengeVersionId === 'challenge-version-1') {
        return [
          {
            id: 'attempt-1',
            learningSessionId: 'session-1',
            challengeVersionId,
            queryExecutionId: 'exec-1',
            attemptNo: 1,
            status: 'passed',
            score: null,
            evaluation: null,
            submittedAt: '2026-03-24T00:00:00.000Z',
            queryExecution: {
              sqlText: 'select 1',
              status: 'success',
              rowsReturned: 1,
              durationMs: 10,
              totalCost: 5,
            },
          },
        ];
      }

      return [
        {
          id: 'attempt-2',
          learningSessionId: 'session-2',
          challengeVersionId,
          queryExecutionId: 'exec-2',
          attemptNo: 1,
          status: 'failed',
          score: null,
          evaluation: null,
          submittedAt: '2026-03-23T00:00:00.000Z',
          queryExecution: {
            sqlText: 'select 2',
            status: 'success',
            rowsReturned: 0,
            durationMs: 10,
            totalCost: 5,
          },
        },
      ];
    });

    mocks.leaderboardApi.get.mockImplementation(
      async (period: 'weekly' | 'monthly' | 'alltime') => {
        if (period === 'monthly') {
          const entries = [
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
            {
              rank: 2,
              userId: 'user-1',
              username: 'alice',
              displayName: 'Alice',
              avatarUrl: null,
              points: 390,
              challengesCompleted: 5,
              streak: 9,
            },
          ];
          return { entries, viewer: entries[1]! };
        }

        const entries = [
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
        return { entries, viewer: entries[0]! };
      },
    );

    mocks.lessonsApi.get.mockResolvedValue({
      publishedVersionId: 'lesson-version-1',
    });

    mocks.lessonsApi.getVersion.mockResolvedValue({
      id: 'lesson-version-1',
      starterQuery: 'select 1',
    });

    mocks.sessionsApi.create.mockResolvedValue({
      id: 'session-new',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: null, tokens: null });
  });

  it('renders personalized leaderboard stats and challenge list', async () => {
    const user = userEvent.setup();

    await renderLeaderboardPage();

    expect(
      await screen.findByRole('heading', {
        name: /Available Challenges/i,
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/Challenge hub/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.leaderboardApi.get).toHaveBeenCalledWith('alltime', 100);
    });

    const hubSection = screen.getByText(/Challenge hub/i).closest('section');
    expect(hubSection).toBeTruthy();
    expect(within(hubSection as HTMLElement).getByText('820 pts')).toBeInTheDocument();
    expect(within(hubSection as HTMLElement).getByText('7')).toBeInTheDocument();
    expect(within(hubSection as HTMLElement).getByText('12d')).toBeInTheDocument();

    // Default tab is "Not started", so passed challenges are hidden until switching.
    await user.click(screen.getByRole('button', { name: /done/i }));
    expect(await screen.findByText('Filter active users')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /monthly/i }));

    await waitFor(() => {
      expect(mocks.leaderboardApi.get).toHaveBeenCalledWith('monthly', 100);
    });

    const hubAfterMonthly = screen.getByText(/Challenge hub/i).closest('section');
    expect(hubAfterMonthly).toBeTruthy();
    expect(within(hubAfterMonthly as HTMLElement).getByText('390 pts')).toBeInTheDocument();
    expect(within(hubAfterMonthly as HTMLElement).getByText('5')).toBeInTheDocument();
    expect(within(hubAfterMonthly as HTMLElement).getByText('9d')).toBeInTheDocument();
  });

  it.skip('creates submission via popup database selector', async () => {
    const user = userEvent.setup();

    await renderLeaderboardPage();

    const createBtn = await screen.findByRole('button', {
      name: /create submission for filter active users/i,
    });
    await act(async () => {
      createBtn.click();
    });

    const dialogTitle = await waitFor(
      () => screen.getByText(/choose database/i),
      { timeout: 5000 },
    );
    const dialogRoot = dialogTitle.closest('[role="dialog"]') ?? dialogTitle.parentElement;
    expect(dialogRoot).toBeTruthy();
    expect(within(dialogRoot as HTMLElement).getByRole('heading', { name: /choose database/i })).toBeInTheDocument();

    // Pick a different scale to exercise the payload.
    const tinyBtn = within(dialogRoot as HTMLElement).getByRole('button', { name: 'Tiny' });
    await user.click(tinyBtn);

    const confirmBtn = within(dialogRoot as HTMLElement).getByRole('button', { name: /^Create submission$/i });
    await user.click(confirmBtn);

    await waitFor(() =>
      expect(mocks.sessionsApi.create).toHaveBeenCalledWith({
        challengeVersionId: 'challenge-version-1',
      }),
    );

    await waitFor(() => {
      expect(routerPush).toHaveBeenCalledWith('/lab/session-new');
    });
  });
});
