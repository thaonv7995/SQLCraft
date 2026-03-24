import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LessonPage from './page';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  saveLabBootstrap: vi.fn(),
  toastError: vi.fn(),
  tracksApi: {
    get: vi.fn(),
  },
  lessonsApi: {
    get: vi.fn(),
    getVersion: vi.fn(),
  },
  sessionsApi: {
    list: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ trackId: 'track-1', lessonId: 'lesson-2' }),
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('react-hot-toast', () => ({
  default: {
    error: mocks.toastError,
  },
}));

vi.mock('@/components/lesson/lesson-markdown', () => ({
  LessonMarkdown: ({ content }: { content: string }) => <div data-testid="lesson-markdown">{content}</div>,
}));

vi.mock('@/lib/lab-bootstrap', () => ({
  saveLabBootstrap: (...args: unknown[]) => mocks.saveLabBootstrap(...args),
}));

vi.mock('@/lib/api', () => ({
  tracksApi: mocks.tracksApi,
  lessonsApi: mocks.lessonsApi,
  sessionsApi: mocks.sessionsApi,
}));

function renderLessonPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <LessonPage />
    </QueryClientProvider>,
  );
}

describe('LessonPage', () => {
  beforeEach(() => {
    mocks.tracksApi.get.mockResolvedValue({
      id: 'track-1',
      title: 'SQL Fundamentals',
      slug: 'sql-fundamentals',
      description: 'Track description',
      difficulty: 'beginner',
      lessonCount: 3,
      lessons: [
        {
          id: 'lesson-1',
          trackId: 'track-1',
          title: 'Intro',
          slug: 'intro',
          description: 'Intro lesson',
          difficulty: 'beginner',
          estimatedMinutes: 10,
          sortOrder: 1,
          publishedVersionId: 'version-1',
        },
        {
          id: 'lesson-2',
          trackId: 'track-1',
          title: 'Filtering',
          slug: 'filtering',
          description: 'Filtering lesson',
          difficulty: 'beginner',
          estimatedMinutes: 15,
          sortOrder: 2,
          publishedVersionId: 'version-2',
        },
        {
          id: 'lesson-3',
          trackId: 'track-1',
          title: 'Sorting',
          slug: 'sorting',
          description: 'Sorting lesson',
          difficulty: 'beginner',
          estimatedMinutes: 12,
          sortOrder: 3,
          publishedVersionId: 'version-3',
        },
      ],
    });

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
      content: '# Filtering\n\n```sql\nSELECT * FROM users;\n```',
      starterQuery: 'SELECT * FROM users;',
      isPublished: true,
      schemaTemplateId: 'schema-1',
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
      challenges: [],
      schemaTemplate: {
        id: 'schema-1',
        name: 'Ecommerce',
        description: 'Production-like shop schema',
        version: 3,
        definition: {
          tables: [{ name: 'users' }, { name: 'orders' }],
        },
        status: 'published',
        createdAt: '2026-03-24T00:00:00.000Z',
        updatedAt: '2026-03-24T00:00:00.000Z',
      },
    });

    mocks.sessionsApi.list.mockResolvedValue([]);
    mocks.sessionsApi.create.mockResolvedValue({
      id: 'session-1',
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders lesson order and schema/starter query context', async () => {
    renderLessonPage();

    expect(await screen.findByRole('heading', { name: 'Filtering' })).toBeInTheDocument();
    expect(screen.getByText('Lesson 2 of 3')).toBeInTheDocument();
    expect(screen.getByText('Starter query ready')).toBeInTheDocument();
    expect(screen.getByText('Ecommerce')).toBeInTheDocument();
    expect(screen.getByText('users')).toBeInTheDocument();
  });

  it('creates a new lab session and redirects when Start Lab is clicked', async () => {
    const user = userEvent.setup();

    renderLessonPage();

    await user.click(await screen.findByRole('button', { name: /start lab/i }));

    await waitFor(() => {
      expect(mocks.sessionsApi.create).toHaveBeenCalledWith({ lessonVersionId: 'version-2' });
    });

    expect(mocks.saveLabBootstrap).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({
        mode: 'lesson',
        lessonPath: '/tracks/track-1/lessons/lesson-2',
        lessonTitle: 'Filtering',
        starterQuery: 'SELECT * FROM users;',
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith('/lab/session-1');
  });
});
