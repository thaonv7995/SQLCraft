import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    validateDraft: vi.fn(),
    create: vi.fn(),
    createVersion: vi.fn(),
    getDraft: vi.fn(),
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

vi.mock('@/components/ui/sql-editor', () => ({
  SqlEditor: ({ value }: { value: string }) => <div data-testid="mock-sql-editor">{value}</div>,
}));

vi.mock('@/lib/api', () => ({
  tracksApi: mocks.tracksApi,
  challengesApi: mocks.challengesApi,
}));

function createEditableDraft(challengeId: string) {
  return {
    id: challengeId,
    lessonId: 'lesson-1',
    slug: 'filter-active-users',
    title: 'Filter active users',
    description: 'Return active users only.',
    difficulty: 'intermediate' as const,
    sortOrder: 1,
    points: 200,
    status: 'draft' as const,
    publishedVersionId: null,
    updatedAt: '2026-03-24T00:00:00.000Z',
    createdAt: '2026-03-20T00:00:00.000Z',
    latestVersion: {
      id: 'challenge-version-1',
      versionNo: 1,
      problemStatement: 'Return active users quickly.',
      hintText: 'Use the active flag.',
      expectedResultColumns: ['id', 'email'],
      referenceSolution: 'SELECT id, email FROM users WHERE active = true ORDER BY id;',
      validatorType: 'result_set',
      validatorConfig: {
        baselineDurationMs: 200,
        requiresIndexOptimization: true,
      },
      isPublished: false,
      reviewStatus: 'pending' as const,
      reviewNotes: 'Tighten the expected ordering.',
      reviewedBy: null,
      reviewedAt: null,
      publishedAt: null,
      createdAt: '2026-03-24T00:00:00.000Z',
    },
  };
}

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
        latestVersionReviewStatus: 'pending',
        latestVersionReviewNotes: 'Tighten the expected ordering.',
        latestVersionReviewedAt: null,
        updatedAt: '2026-03-24T00:00:00.000Z',
        createdAt: '2026-03-20T00:00:00.000Z',
      },
    ]);

    mocks.challengesApi.validateDraft.mockResolvedValue({
      valid: true,
      errors: [],
      warnings: [],
      normalized: {
        slug: 'index-active-users',
        expectedResultColumns: ['id', 'email'],
        referenceSolution: 'SELECT id, email FROM users WHERE active = true ORDER BY id;',
        validatorConfig: {
          baselineDurationMs: 200,
          requiresIndexOptimization: true,
        },
      },
    });

    mocks.challengesApi.create.mockResolvedValue({
      challenge: { id: 'challenge-2' },
      version: { id: 'challenge-version-2' },
    });

    mocks.challengesApi.createVersion.mockResolvedValue({
      challenge: { id: 'challenge-1' },
      version: { id: 'challenge-version-2' },
    });

    mocks.challengesApi.getDraft.mockImplementation(async (challengeId: string) =>
      createEditableDraft(challengeId),
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a new draft only after running server-side preflight validation', async () => {
    renderContributorPage();

    expect(
      await screen.findByRole('heading', { name: /manage submission drafts/i }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Filter active users')).toBeInTheDocument();
    expect(
      await screen.findByRole('option', { name: 'SQL Fundamentals / Filtering' }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Practice Set'), { target: { value: 'lesson-1' } });
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Index active users' } });
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'index-active-users' } });
    fireEvent.change(screen.getByLabelText('Points'), { target: { value: '200' } });
    fireEvent.change(screen.getByLabelText('Problem Statement'), {
      target: { value: 'Return active users quickly and reward indexed solutions.' },
    });
    fireEvent.change(screen.getByLabelText('Reference Solution'), {
      target: { value: 'SELECT id, email FROM users WHERE active = true ORDER BY id;' },
    });

    fireEvent.click(screen.getByRole('button', { name: /create draft/i }));

    await waitFor(() => {
      expect(mocks.challengesApi.validateDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          lessonId: 'lesson-1',
          title: 'Index active users',
          points: 200,
          problemStatement: 'Return active users quickly and reward indexed solutions.',
          referenceSolution: 'SELECT id, email FROM users WHERE active = true ORDER BY id;',
        }),
      );
    });

    await waitFor(() => {
      expect(mocks.challengesApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          lessonId: 'lesson-1',
          title: 'Index active users',
          points: 200,
        }),
      );
    });

    await waitFor(() => {
      expect(mocks.challengesApi.getDraft).toHaveBeenCalledWith('challenge-2');
    });
  });

  it('loads an existing draft and submits a new version when the user edits it', async () => {
    const user = userEvent.setup();

    renderContributorPage();

    expect(await screen.findByText('Filter active users')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    await waitFor(() => {
      expect(mocks.challengesApi.getDraft).toHaveBeenCalledWith('challenge-1');
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Filter active users')).toBeInTheDocument();
    });

    const problemStatement = screen.getByLabelText('Problem Statement');
    await user.clear(problemStatement);
    await user.type(problemStatement, 'Return active users with explicit ordering.');

    await user.click(screen.getByRole('button', { name: /submit new version/i }));

    await waitFor(() => {
      expect(mocks.challengesApi.validateDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          challengeId: 'challenge-1',
          slug: 'filter-active-users',
          problemStatement: 'Return active users with explicit ordering.',
        }),
      );
    });

    await waitFor(() => {
      expect(mocks.challengesApi.createVersion).toHaveBeenCalledWith(
        'challenge-1',
        expect.objectContaining({
          lessonId: 'lesson-1',
          slug: 'filter-active-users',
          problemStatement: 'Return active users with explicit ordering.',
        }),
      );
    });
  });
});
