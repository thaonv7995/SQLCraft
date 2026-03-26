import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChallengePage from './page';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  saveLabBootstrap: vi.fn(),
  toastError: vi.fn(),
  lessonsApi: {
    get: vi.fn(),
    getVersion: vi.fn(),
  },
  challengesApi: {
    getVersion: vi.fn(),
    listAttempts: vi.fn(),
    getLeaderboard: vi.fn(),
    submitAttempt: vi.fn(),
  },
  sessionsApi: {
    list: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({
    trackId: 'track-1',
    lessonId: 'lesson-2',
    challengeId: 'challenge-1',
  }),
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: mocks.toastError,
  },
}));

vi.mock('@/lib/lab-bootstrap', () => ({
  saveLabBootstrap: (...args: unknown[]) => mocks.saveLabBootstrap(...args),
}));

vi.mock('@/lib/api', () => ({
  lessonsApi: mocks.lessonsApi,
  challengesApi: mocks.challengesApi,
  sessionsApi: mocks.sessionsApi,
}));

function renderChallengePage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <ChallengePage />
    </QueryClientProvider>,
  );
}

describe('ChallengePage', () => {
  beforeEach(() => {
    mocks.lessonsApi.get.mockResolvedValue({
      id: 'lesson-2',
      trackId: 'track-1',
      title: 'Filtering',
      slug: 'filtering',
      description: 'Filtering lesson',
      difficulty: 'beginner',
      estimatedMinutes: 15,
      sortOrder: 2,
      publishedVersionId: 'version-2',
    });

    mocks.lessonsApi.getVersion.mockResolvedValue({
      id: 'version-2',
      lessonId: 'lesson-2',
      versionNo: 1,
      title: 'Filtering',
      content: '# Filtering',
      starterQuery: 'SELECT * FROM users;',
      isPublished: true,
      schemaTemplateId: null,
      datasetTemplateId: null,
      publishedAt: '2026-03-24T00:00:00.000Z',
      createdAt: '2026-03-24T00:00:00.000Z',
      lesson: {
        id: 'lesson-2',
        trackId: 'track-1',
        slug: 'filtering',
        title: 'Filtering',
        difficulty: 'beginner',
        estimatedMinutes: 15,
      },
      challenges: [
        {
          id: 'challenge-1',
          slug: 'filter-active-users',
          title: 'Filter active users',
          description: 'Return only active users.',
          difficulty: 'intermediate',
          sortOrder: 1,
          publishedVersionId: 'challenge-version-1',
        },
      ],
      schemaTemplate: null,
    });

    mocks.challengesApi.getVersion.mockResolvedValue({
      id: 'challenge-version-1',
      challengeId: 'challenge-1',
      lessonId: 'lesson-2',
      slug: 'filter-active-users',
      title: 'Filter active users',
      description: 'Return only active users.',
      difficulty: 'intermediate',
      sortOrder: 1,
      points: 100,
      problemStatement: 'Return the id and email of active users only.',
      hintText: 'Use the active flag.',
      expectedResultColumns: ['id', 'email'],
      validatorType: 'result_set',
      publishedAt: '2026-03-24T00:00:00.000Z',
      createdAt: '2026-03-24T00:00:00.000Z',
    });

    mocks.challengesApi.listAttempts.mockResolvedValue([
      {
        id: 'attempt-1',
        learningSessionId: 'session-1',
        challengeVersionId: 'challenge-version-1',
        queryExecutionId: 'query-1',
        attemptNo: 1,
        status: 'passed',
        score: 100,
        evaluation: { isCorrect: true, feedbackText: 'Correct!' },
        submittedAt: '2026-03-24T00:05:00.000Z',
        queryExecution: {
          sqlText: 'SELECT id, email FROM users WHERE active = true;',
          status: 'succeeded',
          rowsReturned: 42,
          durationMs: 18,
        },
      },
    ]);

    mocks.challengesApi.getLeaderboard.mockResolvedValue([
      {
        rank: 1,
        attemptId: 'attempt-1',
        queryExecutionId: 'query-1',
        userId: 'user-1',
        username: 'alice',
        displayName: 'Alice',
        avatarUrl: null,
        bestDurationMs: 18,
        bestTotalCost: 40,
        sqlText: 'SELECT id, email FROM users WHERE active = true;',
        attemptsCount: 1,
        passedAttempts: 1,
        lastSubmittedAt: '2026-03-24T00:05:00.000Z',
      },
    ]);

    mocks.sessionsApi.list.mockResolvedValue([]);
    mocks.sessionsApi.create.mockResolvedValue({ id: 'session-1' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the redesigned challenge mission board and starts a challenge lab', async () => {
    const user = userEvent.setup();

    renderChallengePage();

    expect(await screen.findByRole('heading', { name: 'Filter active users' })).toBeInTheDocument();
    expect(screen.getByText('Return the id and email of active users only.')).toBeInTheDocument();
    expect(screen.getByText('Use the active flag.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Brief đề bài' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Checklist pass' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bảng điều khiển cá nhân' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /top users/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Timeline submissions' })).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getAllByText('Correct!').length).toBeGreaterThan(0);

    await user.click(await screen.findByRole('button', { name: /bắt đầu challenge lab/i }));

    await waitFor(() => {
      expect(mocks.sessionsApi.create).toHaveBeenCalledWith({
        lessonVersionId: 'version-2',
        challengeVersionId: 'challenge-version-1',
      });
    });

    expect(mocks.saveLabBootstrap).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        mode: 'challenge',
        lessonPath: '/tracks/track-1/lessons/lesson-2',
        challengePath: '/tracks/track-1/lessons/lesson-2/challenges/challenge-1',
        challengeTitle: 'Filter active users',
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith('/lab/session-1');
  });
});
