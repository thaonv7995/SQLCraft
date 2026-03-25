import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AdminContentPage from './page';

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  tracksApi: {
    list: vi.fn(),
    get: vi.fn(),
  },
  challengesApi: {
    listReviewQueue: vi.fn(),
    listPublished: vi.fn(),
    getDraft: vi.fn(),
    reviewVersion: vi.fn(),
  },
  adminApi: {
    listLessonVersions: vi.fn(),
    getLessonVersion: vi.fn(),
    createLessonVersion: vi.fn(),
    publishLessonVersion: vi.fn(),
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: mocks.toastSuccess,
    error: mocks.toastError,
  },
}));

vi.mock('@/components/ui/sql-editor', () => ({
  SqlEditor: ({ value }: { value: string }) => <div data-testid="mock-sql-editor">{value}</div>,
}));

vi.mock('@/lib/api', () => ({
  tracksApi: mocks.tracksApi,
  challengesApi: mocks.challengesApi,
  adminApi: mocks.adminApi,
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
          publishedVersionId: 'lesson-version-2',
        },
      ],
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
        latestVersionReviewStatus: 'pending',
        latestVersionReviewNotes: null,
        latestVersionReviewedAt: null,
        createdBy: {
          id: 'user-2',
          username: 'alice',
          displayName: 'Alice',
        },
        updatedAt: '2026-03-24T00:00:00.000Z',
        createdAt: '2026-03-20T00:00:00.000Z',
      },
    ]);

    mocks.challengesApi.listPublished.mockResolvedValue([]);

    mocks.challengesApi.getDraft.mockResolvedValue({
      id: 'challenge-1',
      lessonId: 'lesson-1',
      slug: 'filter-active-users',
      title: 'Filter active users',
      description: 'Return active users only.',
      difficulty: 'intermediate',
      sortOrder: 1,
      points: 200,
      status: 'draft',
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
        reviewStatus: 'pending',
        reviewNotes: null,
        reviewedBy: null,
        reviewedAt: null,
        publishedAt: null,
        createdAt: '2026-03-24T00:00:00.000Z',
      },
    });

    mocks.challengesApi.reviewVersion.mockResolvedValue({
      id: 'challenge-version-1',
    });

    mocks.adminApi.listLessonVersions.mockResolvedValue([
      {
        id: 'lesson-version-1',
        lessonId: 'lesson-1',
        versionNo: 2,
        title: 'Filtering v2',
        isPublished: false,
        schemaTemplateId: null,
        datasetTemplateId: null,
        publishedAt: null,
        createdAt: '2026-03-24T00:00:00.000Z',
      },
    ]);

    mocks.adminApi.getLessonVersion.mockResolvedValue({
      id: 'lesson-version-1',
      lessonId: 'lesson-1',
      versionNo: 2,
      title: 'Filtering v2',
      content: '## Goal\n\nTeach filtering and ordering.',
      starterQuery: 'SELECT * FROM users;',
      isPublished: false,
      schemaTemplateId: null,
      datasetTemplateId: null,
      publishedAt: null,
      createdBy: 'user-1',
      createdAt: '2026-03-24T00:00:00.000Z',
    });

    mocks.adminApi.createLessonVersion.mockResolvedValue({
      id: 'lesson-version-2',
      lessonId: 'lesson-1',
      versionNo: 3,
      title: 'Filtering v3',
      content: '## Goal\n\nTeach ordering.',
      starterQuery: 'SELECT id FROM users;',
      isPublished: false,
      schemaTemplateId: null,
      datasetTemplateId: null,
      publishedAt: null,
      createdBy: 'user-1',
      createdAt: '2026-03-24T01:00:00.000Z',
    });

    mocks.adminApi.publishLessonVersion.mockResolvedValue({
      id: 'lesson-version-1',
      lessonId: 'lesson-1',
      versionNo: 2,
      title: 'Filtering v2',
      content: '## Goal\n\nTeach filtering and ordering.',
      starterQuery: 'SELECT * FROM users;',
      isPublished: true,
      schemaTemplateId: null,
      datasetTemplateId: null,
      publishedAt: '2026-03-24T02:00:00.000Z',
      createdBy: 'user-1',
      createdAt: '2026-03-24T00:00:00.000Z',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('moderates a selected challenge draft with an approve decision', async () => {
    const user = userEvent.setup();

    renderAdminContentPage();

    await user.click(screen.getByRole('button', { name: 'Review Queue' }));

    expect((await screen.findAllByText('Filter active users')).length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(mocks.challengesApi.getDraft).toHaveBeenCalledWith('challenge-1');
    });

    await user.type(screen.getByLabelText('Review Note'), 'Looks good to publish.');
    await user.click(screen.getByRole('button', { name: /approve & publish/i }));

    await waitFor(() => {
      expect(mocks.challengesApi.reviewVersion).toHaveBeenCalledWith('challenge-version-1', {
        decision: 'approve',
        note: 'Looks good to publish.',
      });
    });
  });

  it('creates a new lesson version from the lessons tab', async () => {
    const user = userEvent.setup();

    renderAdminContentPage();

    await user.click(screen.getByRole('button', { name: 'Lessons' }));

    expect(await screen.findByText('Lesson Version Inventory')).toBeInTheDocument();
    expect(
      await screen.findByRole('option', { name: 'SQL Fundamentals / Filtering' }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.adminApi.listLessonVersions).toHaveBeenCalledWith('lesson-1');
    });

    await user.type(screen.getByLabelText('Version Title'), 'Filtering v3');
    await user.type(screen.getByLabelText('Lesson Content'), '## Goal\n\nTeach ordering.');
    await user.type(screen.getByLabelText('Starter Query'), 'SELECT id FROM users;');

    await user.click(screen.getByRole('button', { name: /create lesson version/i }));

    await waitFor(() => {
      expect(mocks.adminApi.createLessonVersion).toHaveBeenCalledWith({
        lessonId: 'lesson-1',
        title: 'Filtering v3',
        content: '## Goal\n\nTeach ordering.',
        starterQuery: 'SELECT id FROM users;',
      });
    });
  });
});
