import { FastifyRequest, FastifyReply } from 'fastify';
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
} from './admin.schema';
import {
  AdminConfigSchema,
  CreateAdminUserSchema,
  CreateChallengeSchema,
  ImportCanonicalDatabaseSchema,
  ListSystemJobsQuerySchema,
  ListAuditLogsQuerySchema,
  ListPendingScansQuerySchema,
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
  scanSqlDump,
  listPendingScans,
  getAdminSqlDumpScan,
  updateAdminConfig,
} from './admin.service';

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

export async function scanSqlDumpHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const file = await request.file({
    limits: {
      fileSize: 400 * 1024 * 1024,
    },
  });

  if (!file) {
    throw new ValidationError('No SQL dump uploaded');
  }

  const chunks: Buffer[] = [];
  for await (const chunk of file.file) {
    chunks.push(chunk);
  }

  const result = await scanSqlDump(file.filename, Buffer.concat(chunks));
  reply.send(success(result, 'SQL dump scanned successfully'));
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
