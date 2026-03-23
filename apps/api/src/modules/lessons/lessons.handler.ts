import type { FastifyRequest, FastifyReply } from 'fastify';
import type { JwtPayload } from '../../plugins/auth';
import { success, created, MESSAGES } from '../../lib/response';
import {
  getPublishedLesson,
  getPublishedLessonVersion,
  createLesson,
  createLessonVersion,
  publishLessonVersion,
} from './lessons.service';
import {
  CreateLessonSchema,
  CreateLessonVersionSchema,
} from './lessons.schema';
import type {
  LessonParams,
  LessonVersionParams,
  AdminLessonVersionParams,
  CreateLessonBody,
  CreateLessonVersionBody,
} from './lessons.schema';

export async function getLessonHandler(
  request: FastifyRequest<{ Params: LessonParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { lessonId } = request.params;
  const lesson = await getPublishedLesson(lessonId);
  return reply.send(success(lesson, MESSAGES.LESSON_RETRIEVED));
}

export async function getLessonVersionHandler(
  request: FastifyRequest<{ Params: LessonVersionParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { versionId } = request.params;
  const version = await getPublishedLessonVersion(versionId);
  return reply.send(success(version, MESSAGES.LESSON_VERSION_RETRIEVED));
}

export async function createLessonHandler(
  request: FastifyRequest<{ Body: CreateLessonBody }>,
  reply: FastifyReply,
): Promise<void> {
  const body = CreateLessonSchema.parse(request.body);
  const userId = (request.user as JwtPayload | undefined)?.sub ?? '';
  const lesson = await createLesson(body, userId);
  return reply.status(201).send(created(lesson, MESSAGES.LESSON_RETRIEVED));
}

export async function createLessonVersionHandler(
  request: FastifyRequest<{ Body: CreateLessonVersionBody }>,
  reply: FastifyReply,
): Promise<void> {
  const body = CreateLessonVersionSchema.parse(request.body);
  const userId = (request.user as JwtPayload | undefined)?.sub ?? '';
  const version = await createLessonVersion(body, userId);
  return reply.status(201).send(created(version, MESSAGES.LESSON_VERSION_RETRIEVED));
}

export async function publishLessonVersionHandler(
  request: FastifyRequest<{ Params: AdminLessonVersionParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;
  const published = await publishLessonVersion(id);
  return reply.send(success(published, MESSAGES.CONTENT_PUBLISHED));
}
