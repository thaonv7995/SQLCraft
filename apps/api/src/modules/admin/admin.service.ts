import {
  tracksRepository,
  lessonsRepository,
  challengesRepository,
  usersRepository,
  adminRepository,
} from '../../db/repositories';
import { NotFoundError } from '../../lib/errors';
import type {
  CreateTrackBody,
  UpdateTrackBody,
  CreateLessonBody,
  CreateLessonVersionBody,
  CreateChallengeBody,
  ListUsersQuery,
  UpdateUserStatusBody,
  UpdateUserRoleBody,
} from './admin.schema';
import type {
  CreateTrackResult,
  UpdateTrackResult,
  CreateLessonResult,
  CreateLessonVersionResult,
  PublishLessonVersionResult,
  CreateChallengeResult,
  PublishChallengeVersionResult,
  ListUsersResult,
  UpdateUserStatusResult,
  UpdateUserRoleResult,
  SystemHealthResult,
} from './admin.types';

// ─── Tracks ───────────────────────────────────────────────────────────────────

export async function createTrack(
  userId: string,
  body: CreateTrackBody,
): Promise<CreateTrackResult> {
  return tracksRepository.create({ ...body, createdBy: userId });
}

export async function updateTrack(
  id: string,
  body: UpdateTrackBody,
): Promise<UpdateTrackResult> {
  const track = await tracksRepository.update(id, body);
  if (!track) throw new NotFoundError('Track not found');
  return track;
}

// ─── Lessons ──────────────────────────────────────────────────────────────────

export async function createLesson(
  userId: string,
  body: CreateLessonBody,
): Promise<CreateLessonResult> {
  const trackExists = await tracksRepository.findById(body.trackId);
  if (!trackExists) throw new NotFoundError('Track not found');
  return lessonsRepository.createLesson({ ...body, createdBy: userId });
}

export async function createLessonVersion(
  userId: string,
  body: CreateLessonVersionBody,
): Promise<CreateLessonVersionResult> {
  const lessonExists = await lessonsRepository.existsById(body.lessonId);
  if (!lessonExists) throw new NotFoundError('Lesson not found');

  const latestVersionNo = await lessonsRepository.getLatestVersionNo(body.lessonId);
  const versionNo = latestVersionNo + 1;

  return lessonsRepository.createVersion({ ...body, versionNo, createdBy: userId });
}

export async function publishLessonVersion(
  versionId: string,
): Promise<PublishLessonVersionResult> {
  const version = await lessonsRepository.findVersionById(versionId);
  if (!version) throw new NotFoundError('Lesson version not found');

  const published = await lessonsRepository.publishVersion(versionId, version.lessonId);
  if (!published) throw new NotFoundError('Lesson version not found');

  return published;
}

// ─── Challenges ───────────────────────────────────────────────────────────────

export async function createChallenge(
  userId: string,
  body: CreateChallengeBody,
): Promise<CreateChallengeResult> {
  const lessonExists = await lessonsRepository.existsById(body.lessonId);
  if (!lessonExists) throw new NotFoundError('Lesson not found');

  const challenge = await challengesRepository.createChallenge({
    lessonId: body.lessonId,
    slug: body.slug,
    title: body.title,
    description: body.description,
    difficulty: body.difficulty,
    sortOrder: body.sortOrder,
  });

  const version = await challengesRepository.createVersion({
    challengeId: challenge.id,
    versionNo: 1,
    problemStatement: body.problemStatement,
    hintText: body.hintText,
    expectedResultColumns: body.expectedResultColumns as unknown as Record<string, unknown>,
    referenceSolution: body.referenceSolution,
    validatorType: body.validatorType,
    validatorConfig: body.validatorConfig as unknown as Record<string, unknown>,
    createdBy: userId,
  });

  return { challenge, version };
}

export async function publishChallengeVersion(
  versionId: string,
): Promise<PublishChallengeVersionResult> {
  const version = await challengesRepository.findVersionById(versionId);
  if (!version) throw new NotFoundError('Challenge version not found');

  const published = await challengesRepository.publishVersion(versionId, version.challengeId);
  if (!published) throw new NotFoundError('Challenge version not found');

  return published;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function listUsers(query: ListUsersQuery): Promise<ListUsersResult> {
  const { items, total } = await usersRepository.listUsers(query.page, query.limit, {
    status: query.status,
    search: query.search,
    role: query.role,
  });
  return {
    items,
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
  };
}

export async function updateUserStatus(
  id: string,
  body: UpdateUserStatusBody,
): Promise<UpdateUserStatusResult> {
  const updated = await usersRepository.updateStatus(id, body.status);
  if (!updated) throw new NotFoundError('User not found');
  return updated;
}

export async function updateUserRole(
  id: string,
  body: UpdateUserRoleBody,
): Promise<UpdateUserRoleResult> {
  const user = await usersRepository.findById(id);
  if (!user) throw new NotFoundError('User not found');
  await usersRepository.setUserRole(id, body.role);
  const roles = await usersRepository.getRoleNames(id);
  return { id: user.id, email: user.email, username: user.username, roles, updatedAt: user.updatedAt };
}

// ─── System ───────────────────────────────────────────────────────────────────

export async function getSystemHealth(): Promise<SystemHealthResult> {
  const stats = await adminRepository.getSystemHealthStats();
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    stats,
  };
}
