import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../../lib/errors';

vi.mock('../../../db/repositories', () => ({
  lessonsRepository: {
    findPublishedById: vi.fn(),
    findPublishedVersionById: vi.fn(),
    findById: vi.fn(),
    getPublishedChallenges: vi.fn(),
    findSchemaTemplateById: vi.fn(),
    createLesson: vi.fn(),
    existsById: vi.fn(),
    getLatestVersionNo: vi.fn(),
    createVersion: vi.fn(),
    findVersionById: vi.fn(),
    publishVersion: vi.fn(),
  },
  tracksRepository: {
    findById: vi.fn(),
  },
}));

import { lessonsRepository } from '../../../db/repositories';
import { getPublishedLesson, getPublishedLessonVersion } from '../lessons.service';

const publishedLesson = {
  id: 'lesson-1',
  trackId: 'track-1',
  slug: 'intro-to-select',
  title: 'Introduction to SELECT',
  description: 'Learn the SELECT statement.',
  difficulty: 'beginner' as const,
  status: 'published' as const,
  sortOrder: 1,
  estimatedMinutes: 15,
  publishedVersionId: 'version-1',
  createdAt: new Date('2026-03-24T09:00:00.000Z'),
  updatedAt: new Date('2026-03-24T09:00:00.000Z'),
};

const publishedVersion = {
  id: 'version-1',
  lessonId: 'lesson-1',
  versionNo: 1,
  title: 'Introduction to SELECT',
  content: '# Introduction to SELECT',
  starterQuery: 'SELECT * FROM products LIMIT 10;',
  isPublished: true,
  schemaTemplateId: 'schema-1',
  datasetTemplateId: null,
  publishedAt: new Date('2026-03-24T09:00:00.000Z'),
  createdAt: new Date('2026-03-24T09:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getPublishedLesson()', () => {
  it('returns the published lesson payload with publishedVersionId intact', async () => {
    vi.mocked(lessonsRepository.findPublishedById).mockResolvedValue(publishedLesson);

    const result = await getPublishedLesson('lesson-1');

    expect(result.id).toBe('lesson-1');
    expect(result.publishedVersionId).toBe('version-1');
  });

  it('throws NotFoundError when the lesson is missing', async () => {
    vi.mocked(lessonsRepository.findPublishedById).mockResolvedValue(null);

    await expect(getPublishedLesson('missing-lesson')).rejects.toThrow(NotFoundError);
  });
});

describe('getPublishedLessonVersion()', () => {
  it('returns lesson version details with lesson, challenge summaries, and schema template', async () => {
    vi.mocked(lessonsRepository.findPublishedVersionById).mockResolvedValue(publishedVersion);
    vi.mocked(lessonsRepository.findById).mockResolvedValue({
      id: 'lesson-1',
      trackId: 'track-1',
      slug: 'intro-to-select',
      title: 'Introduction to SELECT',
      difficulty: 'beginner',
      estimatedMinutes: 15,
    });
    vi.mocked(lessonsRepository.getPublishedChallenges).mockResolvedValue([
      {
        id: 'challenge-1',
        slug: 'filter-products',
        title: 'Filter Products',
        description: 'Filter active products only.',
        difficulty: 'beginner',
        sortOrder: 1,
        publishedVersionId: 'challenge-version-1',
      },
    ]);
    vi.mocked(lessonsRepository.findSchemaTemplateById).mockResolvedValue({
      id: 'schema-1',
      name: 'Ecommerce',
      description: 'Seeded ecommerce schema',
      version: 1,
      definition: { tables: [{ name: 'products' }] },
      status: 'published',
      createdBy: 'admin-1',
      createdAt: new Date('2026-03-24T09:00:00.000Z'),
      updatedAt: new Date('2026-03-24T09:00:00.000Z'),
    });

    const result = await getPublishedLessonVersion('version-1');

    expect(result.id).toBe('version-1');
    expect(result.lesson?.trackId).toBe('track-1');
    expect(result.challenges).toHaveLength(1);
    expect(result.challenges[0]?.publishedVersionId).toBe('challenge-version-1');
    expect(result.schemaTemplate?.id).toBe('schema-1');
  });

  it('throws NotFoundError when the version is missing', async () => {
    vi.mocked(lessonsRepository.findPublishedVersionById).mockResolvedValue(null);

    await expect(getPublishedLessonVersion('missing-version')).rejects.toThrow(NotFoundError);
  });
});
