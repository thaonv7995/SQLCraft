import type { FastifyReply, FastifyRequest } from 'fastify';
import { success } from '../../lib/response';
import type { JwtPayload } from '../../plugins/auth';
import {
  CreateDatabaseSessionBodySchema,
  DatabaseParamsSchema,
  ListDatabasesQuerySchema,
} from './databases.schema';
import type {
  CreateDatabaseSessionBody,
  DatabaseParams,
  ListDatabasesQuery,
} from './databases.schema';
import {
  createDatabaseSession,
  getDatabase,
  listDatabases,
} from './databases.service';

export async function listDatabasesHandler(
  request: FastifyRequest<{ Querystring: ListDatabasesQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const query = ListDatabasesQuerySchema.parse(request.query);
  const result = await listDatabases(query);
  reply.send(success(result, 'Databases retrieved successfully'));
}

export async function getDatabaseHandler(
  request: FastifyRequest<{ Params: DatabaseParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { databaseId } = DatabaseParamsSchema.parse(request.params);
  const result = await getDatabase(databaseId);
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
