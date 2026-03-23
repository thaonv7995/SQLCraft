import type { FastifyInstance } from 'fastify';
import type { ListTracksQuery, TrackParams } from './tracks.schema';
import { listTracksHandler, getTrackHandler } from './tracks.handler';

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
}
