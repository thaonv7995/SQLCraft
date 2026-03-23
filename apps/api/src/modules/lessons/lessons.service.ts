import { lessonsRepository, tracksRepository } from '../../db/repositories';
import type {
  LessonRow,
  LessonVersionRow,
  ChallengeSummaryRow,
  SchemaTemplateRow,
} from '../../db/repositories';
import { NotFoundError } from '../../lib/errors';
import type { CreateLessonBody, CreateLessonVersionBody } from './lessons.schema';

export type PublishedLesson = Pick<
  LessonRow,
  | 'id'
  | 'trackId'
  | 'slug'
  | 'title'
  | 'description'
  | 'difficulty'
  | 'status'
  | 'sortOrder'
  | 'estimatedMinutes'
  | 'publishedVersionId'
  | 'createdAt'
  | 'updatedAt'
>;

export type PublishedLessonVersion = Pick<
  LessonVersionRow,
  | 'id'
  | 'lessonId'
  | 'versionNo'
  | 'title'
  | 'content'
  | 'starterQuery'
  | 'isPublished'
  | 'schemaTemplateId'
  | 'datasetTemplateId'
  | 'publishedAt'
  | 'createdAt'
>;

export interface LessonVersionWithDetails extends PublishedLessonVersion {
  lesson: Pick<LessonRow, 'id' | 'trackId' | 'slug' | 'title' | 'difficulty' | 'estimatedMinutes'> | null;
  challenges: ChallengeSummaryRow[];
  schemaTemplate: SchemaTemplateRow | null;
}

export async function getPublishedLesson(lessonId: string): Promise<PublishedLesson> {
  const lesson = await lessonsRepository.findPublishedById(lessonId);

  if (!lesson) {
    throw new NotFoundError('Lesson not found');
  }

  return lesson;
}

export async function getPublishedLessonVersion(versionId: string): Promise<LessonVersionWithDetails> {
  const version = await lessonsRepository.findPublishedVersionById(versionId);

  if (!version) {
    throw new NotFoundError('Lesson version not found');
  }

  const [lesson, challenges] = await Promise.all([
    lessonsRepository.findById(version.lessonId),
    lessonsRepository.getPublishedChallenges(version.lessonId),
  ]);

  let schemaTemplate: SchemaTemplateRow | null = null;
  if (version.schemaTemplateId) {
    schemaTemplate = await lessonsRepository.findSchemaTemplateById(version.schemaTemplateId);
  }

  return {
    ...version,
    lesson,
    challenges,
    schemaTemplate,
  };
}

export async function createLesson(data: CreateLessonBody, userId: string): Promise<LessonRow> {
  const track = await tracksRepository.findById(data.trackId);

  if (!track) {
    throw new NotFoundError('Track not found');
  }

  return lessonsRepository.createLesson({ ...data, createdBy: userId });
}

export async function createLessonVersion(
  data: CreateLessonVersionBody,
  userId: string,
): Promise<LessonVersionRow> {
  const lessonExists = await lessonsRepository.existsById(data.lessonId);

  if (!lessonExists) {
    throw new NotFoundError('Lesson not found');
  }

  const latestVersionNo = await lessonsRepository.getLatestVersionNo(data.lessonId);
  const versionNo = latestVersionNo + 1;

  return lessonsRepository.createVersion({ ...data, versionNo, createdBy: userId });
}

export async function publishLessonVersion(versionId: string): Promise<LessonVersionRow> {
  const version = await lessonsRepository.findVersionById(versionId);

  if (!version) {
    throw new NotFoundError('Lesson version not found');
  }

  const published = await lessonsRepository.publishVersion(versionId, version.lessonId);

  if (!published) {
    throw new NotFoundError('Lesson version not found');
  }

  return published;
}
