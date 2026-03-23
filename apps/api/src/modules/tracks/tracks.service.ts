import { tracksRepository } from '../../db/repositories';
import type { TrackRow, LessonSummaryRow } from '../../db/repositories';
import { NotFoundError } from '../../lib/errors';
import type { CreateTrackBody, UpdateTrackBody } from './tracks.schema';

export interface TrackWithLessonCount extends Omit<TrackRow, 'createdBy'> {
  lessonCount: number;
}

export interface PaginatedTracks {
  items: TrackWithLessonCount[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface TrackWithLessons extends TrackRow {
  lessons: LessonSummaryRow[];
  lessonCount: number;
}

export async function listPublishedTracks(page: number, limit: number): Promise<PaginatedTracks> {
  const { items, total } = await tracksRepository.listPublished(page, limit);

  const trackIds = items.map((t) => t.id);
  const lessonCountMap = await tracksRepository.getLessonCountsByTrackIds(trackIds);

  const tracksWithCounts: TrackWithLessonCount[] = items.map((track) => ({
    ...track,
    lessonCount: lessonCountMap[track.id] ?? 0,
  }));

  return {
    items: tracksWithCounts,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getPublishedTrack(trackId: string): Promise<TrackWithLessons> {
  const track = await tracksRepository.findPublishedById(trackId);

  if (!track) {
    throw new NotFoundError('Track not found');
  }

  const lessons = await tracksRepository.getPublishedLessons(trackId);

  return {
    ...track,
    lessons,
    lessonCount: lessons.length,
  };
}

export async function createTrack(data: CreateTrackBody, userId: string): Promise<TrackRow> {
  return tracksRepository.create({ ...data, createdBy: userId });
}

export async function updateTrack(id: string, data: UpdateTrackBody): Promise<TrackRow> {
  const track = await tracksRepository.update(id, data);

  if (!track) {
    throw new NotFoundError('Track not found');
  }

  return track;
}
