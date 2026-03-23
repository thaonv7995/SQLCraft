import type { FastifyInstance } from 'fastify';
import type {
  ListTracksQuery,
  CreateTrackBody,
  UpdateTrackBody,
  TrackParams,
  AdminTrackParams,
} from './tracks.schema';
import {
  listTracksHandler,
  getTrackHandler,
  createTrackHandler,
  updateTrackHandler,
} from './tracks.handler';

export default async function tracksRouter(fastify: FastifyInstance): Promise<void> {
  // GET /v1/tracks
  fastify.get<{ Querystring: ListTracksQuery }>(
    '/v1/tracks',
    {
      onRequest: [fastify.optionalAuthenticate],
      schema: {
        tags: ['Tracks'],
        summary: 'List published tracks with lesson counts',
        querystring: {
          type: 'object',
          properties: {
            page: { type: 'integer', minimum: 1, default: 1 },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          },
        },
      },
    },
    listTracksHandler,
  );

  // GET /v1/tracks/:trackId
  fastify.get<{ Params: TrackParams }>(
    '/v1/tracks/:trackId',
    {
      onRequest: [fastify.optionalAuthenticate],
      schema: {
        tags: ['Tracks'],
        summary: 'Get a single track with lessons summary',
        params: {
          type: 'object',
          required: ['trackId'],
          properties: {
            trackId: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    getTrackHandler,
  );

  // POST /v1/admin/tracks
  fastify.post<{ Body: CreateTrackBody }>(
    '/v1/admin/tracks',
    {
      onRequest: [fastify.authenticate, fastify.authorize(['admin'])],
      schema: {
        tags: ['Admin'],
        summary: 'Create a new track',
        security: [{ bearerAuth: [] }],
        body: {
          type: 'object',
          required: ['slug', 'title'],
          properties: {
            slug: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            coverUrl: { type: 'string' },
            difficulty: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'] },
            sortOrder: { type: 'integer' },
          },
        },
      },
    },
    createTrackHandler,
  );

  // PATCH /v1/admin/tracks/:id
  fastify.patch<{ Params: AdminTrackParams; Body: UpdateTrackBody }>(
    '/v1/admin/tracks/:id',
    {
      onRequest: [fastify.authenticate, fastify.authorize(['admin'])],
      schema: {
        tags: ['Admin'],
        summary: 'Update a track',
        security: [{ bearerAuth: [] }],
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    updateTrackHandler,
  );
}
