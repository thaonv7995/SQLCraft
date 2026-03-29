import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { finished } from 'node:stream/promises';
import { pipeline } from 'node:stream/promises';
import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../../lib/config';
import { success, created, MESSAGES } from '../../lib/response';
import { ValidationError } from '../../lib/errors';
import { clientIpForAudit, clientUserAgentForAudit } from '../../lib/request-audit';
import type { JwtPayload } from '../../plugins/auth';
import type {
  AdminConfigBody,
  CreateAdminUserBody,
  CreateChallengeBody,
  ListUsersQuery,
  UpdateAdminUserBody,
  UpdateUserStatusBody,
  UpdateUserRoleBody,
  ImportCanonicalDatabaseBody,
  ListSystemJobsQuery,
  ListAuditLogsQuery,
  AdminIdParams,
  ListPendingScansQuery,
  SqlDumpScanIdParams,
  SqlDumpUploadSessionIdParams,
  CreateSqlDumpUploadSessionBody,
  PresignSqlDumpUploadPartBody,
  CompleteSqlDumpUploadSessionBody,
} from './admin.schema';
import {
  AdminConfigSchema,
  CompleteSqlDumpUploadSessionSchema,
  CreateAdminUserSchema,
  CreateChallengeSchema,
  CreateSqlDumpUploadSessionSchema,
  ImportCanonicalDatabaseSchema,
  ListSystemJobsQuerySchema,
  ListAuditLogsQuerySchema,
  ListPendingScansQuerySchema,
  PresignSqlDumpUploadPartSchema,
  UpdateAdminUserSchema,
} from './admin.schema';
import {
  clearStaleSessions,
  createAdminUser,
  deleteDatabase,
  deleteAdminUser,
  createChallenge,
  deleteAdminChallenge,
  publishChallengeVersion,
  updateAdminChallenge,
  listUsers,
  updateAdminUser,
  updateUserStatus,
  updateUserRole,
  getSystemHealth,
  getAdminConfig,
  importCanonicalDatabase,
  listSystemJobs,
  listAuditLogs,
  recordAuditLog,
  resetAdminConfig,
  scanSqlDumpFromUploadedFile,
  listPendingScans,
  getAdminSqlDumpScan,
  updateAdminConfig,
  listPendingSchemaTemplatesForReview,
  approveSchemaTemplateReview,
  rejectSchemaTemplateReview,
} from './admin.service';
import {
  abortSqlDumpUploadSession,
  completeSqlDumpUploadSession,
  createSqlDumpUploadSession,
  presignSqlDumpUploadPart,
} from './sql-dump-upload-session.service';
import { getDatabaseItemForAdminPendingReview } from '../databases/databases.service';

// ─── Challenges ───────────────────────────────────────────────────────────────

export async function createChallengeHandler(
  request: FastifyRequest<{ Body: CreateChallengeBody }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const result = await createChallenge(userId, request.body);
  reply.status(201).send(created(result, 'Challenge created successfully'));
}

export async function publishChallengeVersionHandler(
  request: FastifyRequest<{ Params: AdminIdParams }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await publishChallengeVersion(request.params.id);
  reply.send(success(result, MESSAGES.CONTENT_PUBLISHED));
}

export async function updateAdminChallengeHandler(
  request: FastifyRequest<{ Params: AdminIdParams; Body: CreateChallengeBody }>,
  reply: FastifyReply,
): Promise<void> {
  const body = CreateChallengeSchema.parse(request.body);
  const result = await updateAdminChallenge(request.params.id, body);
  reply.send(success(result, 'Challenge updated successfully'));
}

export async function deleteAdminChallengeHandler(
  request: FastifyRequest<{ Params: AdminIdParams }>,
  reply: FastifyReply,
): Promise<void> {
  await deleteAdminChallenge(request.params.id);
  reply.status(204).send();
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function listUsersHandler(
  request: FastifyRequest<{ Querystring: ListUsersQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await listUsers(request.query);
  reply.send(success(result, MESSAGES.USERS_RETRIEVED));
}

export async function updateUserStatusHandler(
  request: FastifyRequest<{ Params: AdminIdParams; Body: UpdateUserStatusBody }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await updateUserStatus(request.params.id, request.body);
  reply.send(success(result, 'User status updated successfully'));
}

export async function updateUserRoleHandler(
  request: FastifyRequest<{ Params: AdminIdParams; Body: UpdateUserRoleBody }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await updateUserRole(request.params.id, request.body);
  reply.send(success(result, 'User role updated successfully'));
}

export async function createAdminUserHandler(
  request: FastifyRequest<{ Body: CreateAdminUserBody }>,
  reply: FastifyReply,
): Promise<void> {
  const body = CreateAdminUserSchema.parse(request.body);
  const result = await createAdminUser(body);
  reply.status(201).send(created(result, 'User created successfully'));
}

export async function updateAdminUserHandler(
  request: FastifyRequest<{ Params: AdminIdParams; Body: UpdateAdminUserBody }>,
  reply: FastifyReply,
): Promise<void> {
  const body = UpdateAdminUserSchema.parse(request.body);
  const result = await updateAdminUser(request.params.id, body);
  reply.send(success(result, 'User updated successfully'));
}

export async function deleteAdminUserHandler(
  request: FastifyRequest<{ Params: AdminIdParams }>,
  reply: FastifyReply,
): Promise<void> {
  const actorUserId = (request.user as JwtPayload).sub;
  const result = await deleteAdminUser(actorUserId, request.params.id);
  reply.send(success(result, 'User deleted successfully'));
}

export async function deleteDatabaseHandler(
  request: FastifyRequest<{ Params: AdminIdParams }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const result = await deleteDatabase(request.params.id);
  await recordAuditLog({
    userId,
    action: 'admin.database.delete',
    resourceType: 'schema_template',
    resourceId: result.id,
    payload: {
      name: result.name,
      deletedDatasetTemplates: result.deletedDatasetTemplates,
      reclaimedSandboxInstances: result.reclaimedSandboxInstances,
    },
    ipAddress: clientIpForAudit(request),
    userAgent: clientUserAgentForAudit(request),
  });
  reply.send(success(result, 'Database deleted successfully'));
}

export async function clearStaleSessionsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const result = await clearStaleSessions();
  await recordAuditLog({
    userId,
    action: 'admin.sessions.clear_stale',
    resourceType: 'platform',
    payload: {
      clearedCount: result.clearedCount,
      sessionIds: result.sessionIds.slice(0, 100),
      thresholdMinutes: result.thresholdMinutes,
    },
    ipAddress: clientIpForAudit(request),
    userAgent: clientUserAgentForAudit(request),
  });
  reply.send(success(result, 'Stale sessions cleared successfully'));
}

// ─── System ───────────────────────────────────────────────────────────────────

export async function systemHealthHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const result = await getSystemHealth();
  reply.send(success(result, 'System health retrieved'));
}

export async function getAdminConfigHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const result = await getAdminConfig();
  reply.send(success(result, 'Admin config retrieved successfully'));
}

export async function updateAdminConfigHandler(
  request: FastifyRequest<{ Body: AdminConfigBody }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const body = AdminConfigSchema.parse(request.body);
  const result = await updateAdminConfig(userId, body);
  await recordAuditLog({
    userId,
    action: 'admin.config.update',
    resourceType: 'admin_config',
    payload: {
      scope: 'global',
      sections: Object.keys(body) as string[],
    },
    ipAddress: clientIpForAudit(request),
    userAgent: clientUserAgentForAudit(request),
  });
  reply.send(success(result, 'Admin config updated successfully'));
}

export async function resetAdminConfigHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const result = await resetAdminConfig(userId);
  await recordAuditLog({
    userId,
    action: 'admin.config.reset',
    resourceType: 'admin_config',
    payload: { scope: 'global', toDefault: true },
    ipAddress: clientIpForAudit(request),
    userAgent: clientUserAgentForAudit(request),
  });
  reply.send(success(result, 'Admin config reset successfully'));
}

export async function importCanonicalDatabaseHandler(
  request: FastifyRequest<{ Body: ImportCanonicalDatabaseBody }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const body = ImportCanonicalDatabaseSchema.parse(request.body);
  const result = await importCanonicalDatabase(userId, body);
  reply.status(201).send(created(result, 'Canonical database imported successfully'));
}

export async function createSqlDumpUploadSessionHandler(
  request: FastifyRequest<{ Body: CreateSqlDumpUploadSessionBody }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const body = CreateSqlDumpUploadSessionSchema.parse(request.body);
  const result = await createSqlDumpUploadSession(userId, body);
  reply.status(201).send(created(result, 'SQL dump upload session created'));
}

export async function presignSqlDumpUploadPartHandler(
  request: FastifyRequest<{ Params: SqlDumpUploadSessionIdParams; Body: PresignSqlDumpUploadPartBody }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const { partNumber } = PresignSqlDumpUploadPartSchema.parse(request.body);
  const result = await presignSqlDumpUploadPart(userId, request.params.sessionId, partNumber);
  reply.send(success(result, 'Part URL issued'));
}

export async function completeSqlDumpUploadSessionHandler(
  request: FastifyRequest<{ Params: SqlDumpUploadSessionIdParams; Body: CompleteSqlDumpUploadSessionBody }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  const body = CompleteSqlDumpUploadSessionSchema.parse(request.body ?? {});
  const result = await completeSqlDumpUploadSession(userId, request.params.sessionId, body);
  reply.send(success(result, 'SQL dump scanned successfully'));
}

export async function abortSqlDumpUploadSessionHandler(
  request: FastifyRequest<{ Params: SqlDumpUploadSessionIdParams }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  await abortSqlDumpUploadSession(userId, request.params.sessionId);
  reply.send(success({ ok: true }, 'Upload session aborted'));
}

export async function scanSqlDumpHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const multipartLimits = {
    limits: { fileSize: config.SQL_DUMP_MAX_FILE_MB * 1024 * 1024 },
  };

  let tempDir: string | null = null;
  let dumpFileName = '';
  let artifactOnly = false;

  try {
    for await (const part of request.parts(multipartLimits)) {
      if (part.type === 'file') {
        if (!tempDir) {
          tempDir = await mkdtemp(path.join(tmpdir(), 'sqlforge-dump-'));
          const tmpPath = path.join(tempDir, 'upload.sql');
          await pipeline(part.file, createWriteStream(tmpPath));
          dumpFileName = part.filename?.trim() || 'dump.sql';
        } else {
          await finished(part.file);
        }
      } else if (part.type === 'field' && part.fieldname === 'artifactOnly') {
        const raw = String(part.value).trim().toLowerCase();
        artifactOnly = raw === 'true' || raw === '1' || raw === 'yes';
      }
    }

    if (!tempDir) {
      throw new ValidationError('No SQL dump uploaded');
    }

    const tmpPath = path.join(tempDir, 'upload.sql');
    const st = await stat(tmpPath);
    if (st.size === 0) {
      throw new ValidationError('Uploaded SQL dump is empty');
    }

    const userId = (request.user as JwtPayload).sub;
    const result = await scanSqlDumpFromUploadedFile(dumpFileName, tmpPath, st.size, {
      artifactOnly,
      uploadingUserId: userId,
    });
    reply.send(success(result, 'SQL dump scanned successfully'));
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

export async function listPendingScansHandler(
  request: FastifyRequest<{ Querystring: ListPendingScansQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const query = ListPendingScansQuerySchema.parse(request.query);
  const result = await listPendingScans(query);
  reply.send(success(result, 'Pending SQL dump scans retrieved'));
}

export async function getSqlDumpScanHandler(
  request: FastifyRequest<{ Params: SqlDumpScanIdParams }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await getAdminSqlDumpScan(request.params.scanId);
  reply.send(success(result, 'SQL dump scan retrieved'));
}

export async function listPendingSchemaTemplatesForReviewHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const result = await listPendingSchemaTemplatesForReview();
  reply.send(success(result, 'Pending public database uploads retrieved'));
}

export async function getPendingSchemaTemplateReviewDetailHandler(
  request: FastifyRequest<{ Params: AdminIdParams }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await getDatabaseItemForAdminPendingReview(request.params.id);
  reply.send(success(result, 'Pending review database detail retrieved'));
}

export async function approveSchemaTemplateReviewHandler(
  request: FastifyRequest<{ Params: AdminIdParams }>,
  reply: FastifyReply,
): Promise<void> {
  const userId = (request.user as JwtPayload).sub;
  await approveSchemaTemplateReview(request.params.id, userId);
  reply.send(success({ ok: true }, 'Public database approved and published'));
}

export async function rejectSchemaTemplateReviewHandler(
  request: FastifyRequest<{ Params: AdminIdParams }>,
  reply: FastifyReply,
): Promise<void> {
  await rejectSchemaTemplateReview(request.params.id);
  reply.send(success({ ok: true }, 'Public database review rejected'));
}

export async function listSystemJobsHandler(
  request: FastifyRequest<{ Querystring: ListSystemJobsQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const query = ListSystemJobsQuerySchema.parse(request.query);
  const result = await listSystemJobs(query);
  reply.send(success(result, 'System jobs retrieved successfully'));
}

export async function listAuditLogsHandler(
  request: FastifyRequest<{ Querystring: ListAuditLogsQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const query = ListAuditLogsQuerySchema.parse(request.query);
  const result = await listAuditLogs(query);
  reply.send(success(result, 'Audit logs retrieved successfully'));
}
