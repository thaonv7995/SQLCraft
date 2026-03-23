import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundError } from '../../../lib/errors';

// ─── Mock the repository module BEFORE importing the service ─────────────────
vi.mock('../../../db/repositories', () => ({
  tracksRepository: {
    listPublished: vi.fn(),
    getLessonCountsByTrackIds: vi.fn(),
    findPublishedById: vi.fn(),
    getPublishedLessons: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
}));

import { tracksRepository } from '../../../db/repositories';
import {
  listPublishedTracks,
  getPublishedTrack,
  createTrack,
  updateTrack,
} from '../tracks.service';

// Helper to produce a minimal TrackRow fixture
const makeTrack = (overrides = {}) => ({
  id: 'track-1',
  slug: 'sql-fundamentals',
  title: 'SQL Fundamentals',
  description: 'Learn SQL from scratch',
  difficulty: 'beginner' as const,
  status: 'published' as const,
  coverUrl: null,
  sortOrder: 0,
  createdBy: 'user-1',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ...overrides,
});

const makeLessonSummary = (overrides = {}) => ({
  id: 'lesson-1',
  title: 'Intro to SQL',
  slug: 'intro-to-sql',
  description: null,
  difficulty: 'beginner' as const,
  sortOrder: 1,
  estimatedMinutes: 20,
  publishedVersionId: null,
  createdAt: new Date('2024-01-01'),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── listPublishedTracks ──────────────────────────────────────────────────────

describe('listPublishedTracks()', () => {
  it('returns paginated tracks with lesson counts', async () => {
    const track = makeTrack();
    vi.mocked(tracksRepository.listPublished).mockResolvedValue({
      items: [track],
      total: 1,
    });
    vi.mocked(tracksRepository.getLessonCountsByTrackIds).mockResolvedValue({
      'track-1': 5,
    });

    const result = await listPublishedTracks(1, 10);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].lessonCount).toBe(5);
    expect(result.meta.total).toBe(1);
    expect(result.meta.totalPages).toBe(1);
  });

  it('defaults lessonCount to 0 when track has no entries in the count map', async () => {
    vi.mocked(tracksRepository.listPublished).mockResolvedValue({
      items: [makeTrack()],
      total: 1,
    });
    vi.mocked(tracksRepository.getLessonCountsByTrackIds).mockResolvedValue({});

    const result = await listPublishedTracks(1, 10);
    expect(result.items[0].lessonCount).toBe(0);
  });

  it('calculates totalPages correctly', async () => {
    const tracks = Array.from({ length: 3 }, (_, i) => makeTrack({ id: `t${i}` }));
    vi.mocked(tracksRepository.listPublished).mockResolvedValue({ items: tracks, total: 25 });
    vi.mocked(tracksRepository.getLessonCountsByTrackIds).mockResolvedValue({});

    const result = await listPublishedTracks(1, 10);
    expect(result.meta.totalPages).toBe(3);
  });

  it('calls getLessonCountsByTrackIds with the correct ids', async () => {
    const track = makeTrack({ id: 'abc-123' });
    vi.mocked(tracksRepository.listPublished).mockResolvedValue({ items: [track], total: 1 });
    vi.mocked(tracksRepository.getLessonCountsByTrackIds).mockResolvedValue({});

    await listPublishedTracks(1, 10);

    expect(tracksRepository.getLessonCountsByTrackIds).toHaveBeenCalledWith(['abc-123']);
  });
});

// ─── getPublishedTrack ────────────────────────────────────────────────────────

describe('getPublishedTrack()', () => {
  it('returns a track with its lessons', async () => {
    const track = makeTrack();
    const lessons = [makeLessonSummary()];
    vi.mocked(tracksRepository.findPublishedById).mockResolvedValue(track);
    vi.mocked(tracksRepository.getPublishedLessons).mockResolvedValue(lessons);

    const result = await getPublishedTrack('track-1');
    expect(result.id).toBe('track-1');
    expect(result.lessons).toHaveLength(1);
    expect(result.lessonCount).toBe(1);
  });

  it('throws NotFoundError when track does not exist', async () => {
    vi.mocked(tracksRepository.findPublishedById).mockResolvedValue(null);

    await expect(getPublishedTrack('missing-id')).rejects.toThrow(NotFoundError);
    await expect(getPublishedTrack('missing-id')).rejects.toThrow(/not found/i);
  });
});

// ─── createTrack ─────────────────────────────────────────────────────────────

describe('createTrack()', () => {
  it('calls repository.create with merged data', async () => {
    const body = { title: 'New Track', slug: 'new-track', sortOrder: 0, difficulty: 'beginner' as const };
    const created = makeTrack({ ...body, createdBy: 'admin-1' });
    vi.mocked(tracksRepository.create).mockResolvedValue(created);

    await createTrack(body, 'admin-1');

    expect(tracksRepository.create).toHaveBeenCalledWith({
      ...body,
      createdBy: 'admin-1',
    });
  });

  it('returns the created track row', async () => {
    const track = makeTrack();
    vi.mocked(tracksRepository.create).mockResolvedValue(track);
    const result = await createTrack({ title: 'T', slug: 's', sortOrder: 0, difficulty: 'beginner' }, 'u1');
    expect(result).toEqual(track);
  });
});

// ─── updateTrack ─────────────────────────────────────────────────────────────

describe('updateTrack()', () => {
  it('returns the updated track', async () => {
    const updated = makeTrack({ title: 'Updated Title' });
    vi.mocked(tracksRepository.update).mockResolvedValue(updated);

    const result = await updateTrack('track-1', { title: 'Updated Title' });
    expect(result.title).toBe('Updated Title');
  });

  it('throws NotFoundError when update returns null', async () => {
    vi.mocked(tracksRepository.update).mockResolvedValue(null);

    await expect(updateTrack('bad-id', { title: 'X' })).rejects.toThrow(NotFoundError);
  });
});
