import type { FastifyReply, FastifyRequest } from 'fastify';
import { created, success } from '../../lib/response';
import { ForbiddenError, UnauthorizedError } from '../../lib/errors';
import { ADMIN_ROLE_NAME } from '../../lib/roles';
import type { JwtPayload } from '../../plugins/auth';
import {
  UserImportSqlDumpDatabaseSchema,
  type UserImportSqlDumpDatabaseBody,
  SqlDumpScanIdParamsSchema,
  type SqlDumpScanIdParams,
  CreateSqlDumpUploadSessionSchema,
  PresignSqlDumpUploadPartSchema,
  CompleteSqlDumpUploadSessionSchema,
  type CreateSqlDumpUploadSessionBody,
  type PresignSqlDumpUploadPartBody,
  type CompleteSqlDumpUploadSessionBody,
  type SqlDumpUploadSessionIdParams,
} from '../admin/admin.schema';
import {
  importUserDatabaseFromSqlDumpScan,
  getSqlDumpScanForUser,
} from '../admin/admin.service';
import {
  abortSqlDumpUploadSession,
  completeSqlDumpUploadSession,
  createSqlDumpUploadSession,
  presignSqlDumpUploadPart,
} from '../admin/sql-dump-upload-session.service';
import { scanSqlDumpHandler as adminScanSqlDumpHandler } from '../admin/admin.handler';
import {
  AddOwnerDatabaseInvitesBodySchema,
  CreateDatabaseSessionBodySchema,
  DatabaseParamsSchema,
  GetDatabaseQuerySchema,
  ListDatabasesQuerySchema,
  UpdateOwnerDatabaseBodySchema,
} from './databases.schema';
import type {
  AddOwnerDatabaseInvitesBody,
  CreateDatabaseSessionBody,
  DatabaseParams,
  GetDatabaseQuery,
  ListDatabasesQuery,
  UpdateOwnerDatabaseBody,
} from './databases.schema';
import {
  createDatabaseSession,
  getDatabase,
  listDatabases,
  ownerAddDatabaseInvites,
  ownerDeleteDatabase,
  ownerRetriggerGoldenBake,
  ownerUpdateDatabaseDescription,
} from './databases.service';

function assertAdminForIncludeAwaitingGolden(
  includeAwaitingGolden: boolean,
  viewerUserId: string | null | undefined,
  roles: string[] | undefined,
): void {
  if (!includeAwaitingGolden) return;
  if (!viewerUserId) {
    throw new UnauthorizedError('Authentication required for admin database catalog');
  }
  if (!roles?.includes(ADMIN_ROLE_NAME)) {
    throw new ForbiddenError('Admin role required to list databases awaiting golden snapshot');
  }
}

export async function listDatabasesHandler(
  request: FastifyRequest<{ Querystring: ListDatabasesQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const query = ListDatabasesQuerySchema.parse(request.query);
  const viewerUserId = (request.user as JwtPayload | undefined)?.sub ?? null;
  const roles = (request.user as JwtPayload | undefined)?.roles;
  if (query.forChallengeAuthoring && !viewerUserId) {
    throw new UnauthorizedError('Authentication required for challenge authoring database list');
  }
  assertAdminForIncludeAwaitingGolden(query.includeAwaitingGolden, viewerUserId, roles);
  const result = await listDatabases(query, viewerUserId ?? undefined);
  reply.send(success(result, 'Databases retrieved successfully'));
}

export async function getDatabaseHandler(
  request: FastifyRequest<{ Params: DatabaseParams; Querystring: GetDatabaseQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const { databaseId } = DatabaseParamsSchema.parse(request.params);
  const query = GetDatabaseQuerySchema.parse(request.query ?? {});
  const viewerUserId = (request.user as JwtPayload | undefined)?.sub ?? null;
  const roles = (request.user as JwtPayload | undefined)?.roles;
  if (query.forChallengeAuthoring && !viewerUserId) {
    throw new UnauthorizedError('Authentication required for challenge authoring database detail');
  }
  assertAdminForIncludeAwaitingGolden(query.includeAwaitingGolden, viewerUserId, roles);
  const result = await getDatabase(databaseId, {
    forChallengeAuthoring: query.forChallengeAuthoring,
    viewerUserId,
    adminFullCatalog: query.includeAwaitingGolden === true,
  });
  reply.send(success(result, 'Database retrieved successfully'));
}

export async function createDatabaseSessionHandler(
  request: FastifyRequest<{ Body: CreateDatabaseSessionBody }>,
  reply: FastifyReply,
): Promise<void> {
  const body = CreateDatabaseSessionBodySchema.parse(request.body);
  const userId = (request.user as JwtPayload | undefined)?.sub ?? '';
  const result = await createDatabaseSession(userId, body);
  reply.status(201).send(success(result, 'Database session created'));
}

export async function importUserDatabaseHandler(
  request: FastifyRequest<{ Body: UserImportSqlDumpDatabaseBody }>,
  reply: FastifyReply,
): Promise<void> {
  const body = UserImportSqlDumpDatabaseSchema.parse(request.body);
  const userId = (request.user as JwtPayload).sub;
  const result = await importUserDatabaseFromSqlDumpScan(userId, body);
  reply.status(201).send(created(result, 'Database imported successfully'));
}

export async function getUserSqlDumpScanHandler(
  request: FastifyRequest<{ Params: SqlDumpScanIdParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { scanId } = SqlDumpScanIdParamsSchema.parse(request.params);
  const userId = (request.user as JwtPayload).sub;
  const result = await getSqlDumpScanForUser(scanId, userId);
  reply.send(success(result, 'SQL dump scan retrieved'));
}

export async function createUserSqlDumpUploadSessionHandler(
  request: FastifyRequest<{ Body: CreateSqlDumpUploadSessionBody }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const body = CreateSqlDumpUploadSessionSchema.parse(request.body);
  const result = await createSqlDumpUploadSession(userId, body);
  reply.status(201).send(created(result, 'SQL dump upload session created'));
}

export async function presignUserSqlDumpUploadPartHandler(
  request: FastifyRequest<{
    Params: SqlDumpUploadSessionIdParams;
    Body: PresignSqlDumpUploadPartBody;
  }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const { partNumber } = PresignSqlDumpUploadPartSchema.parse(request.body);
  const result = await presignSqlDumpUploadPart(userId, request.params.sessionId, partNumber);
  reply.send(success(result, 'Part URL issued'));
}

export async function completeUserSqlDumpUploadSessionHandler(
  request: FastifyRequest<{
    Params: SqlDumpUploadSessionIdParams;
    Body: CompleteSqlDumpUploadSessionBody;
  }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const body = CompleteSqlDumpUploadSessionSchema.parse(request.body ?? {});
  const result = await completeSqlDumpUploadSession(userId, request.params.sessionId, body);
  reply.send(success(result, 'SQL dump scanned successfully'));
}

export async function abortUserSqlDumpUploadSessionHandler(
  request: FastifyRequest<{ Params: SqlDumpUploadSessionIdParams }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  await abortSqlDumpUploadSession(userId, request.params.sessionId);
  reply.send(success({ ok: true }, 'Upload session aborted'));
}

/** Reuses admin multipart scan logic; tags scan with the authenticated user for import/read access control. */
export async function scanUserSqlDumpHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  return adminScanSqlDumpHandler(request, reply);
}

export async function ownerRetriggerGoldenBakeHandler(
  request: FastifyRequest<{ Params: DatabaseParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { databaseId } = DatabaseParamsSchema.parse(request.params);
  const userId = (request.user as JwtPayload).sub;
  await ownerRetriggerGoldenBake(userId, databaseId);
  reply.send(success(null, 'Golden snapshot bake queued'));
}

export async function ownerDeleteDatabaseHandler(
  request: FastifyRequest<{ Params: DatabaseParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { databaseId } = DatabaseParamsSchema.parse(request.params);
  const userId = (request.user as JwtPayload).sub;
  const result = await ownerDeleteDatabase(userId, databaseId);
  reply.send(success(result, 'Database deleted successfully'));
}

export async function ownerPatchDatabaseHandler(
  request: FastifyRequest<{ Params: DatabaseParams; Body: UpdateOwnerDatabaseBody }>,
  reply: FastifyReply,
): Promise<void> {
  const { databaseId } = DatabaseParamsSchema.parse(request.params);
  const userId = (request.user as JwtPayload).sub;
  const body = UpdateOwnerDatabaseBodySchema.parse(request.body ?? {});
  await ownerUpdateDatabaseDescription(userId, databaseId, body.description);
  reply.send(success(null, 'Database updated'));
}

export async function ownerAddInvitesHandler(
  request: FastifyRequest<{ Params: DatabaseParams; Body: AddOwnerDatabaseInvitesBody }>,
  reply: FastifyReply,
): Promise<void> {
  const { databaseId } = DatabaseParamsSchema.parse(request.params);
  const userId = (request.user as JwtPayload).sub;
  const body = AddOwnerDatabaseInvitesBodySchema.parse(request.body);
  await ownerAddDatabaseInvites(userId, databaseId, body.userIds);
  reply.send(success(null, 'Invites added'));
}
