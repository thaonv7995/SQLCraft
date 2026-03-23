import type { FastifyRequest, FastifyReply } from 'fastify';
import type { JwtPayload } from '../../plugins/auth';
import { success, created, MESSAGES } from '../../lib/response';
import {
  listPublishedTracks,
  getPublishedTrack,
  createTrack,
  updateTrack,
} from './tracks.service';
import {
  ListTracksQuerySchema,
  CreateTrackSchema,
  UpdateTrackSchema,
} from './tracks.schema';
import type {
  ListTracksQuery,
  CreateTrackBody,
  UpdateTrackBody,
  TrackParams,
  AdminTrackParams,
} from './tracks.schema';

export async function listTracksHandler(
  request: FastifyRequest<{ Querystring: ListTracksQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const query = ListTracksQuerySchema.parse(request.query);
  const result = await listPublishedTracks(query.page, query.limit);
  return reply.send(success(result, MESSAGES.TRACKS_RETRIEVED));
}

export async function getTrackHandler(
  request: FastifyRequest<{ Params: TrackParams }>,
  reply: FastifyReply,
): Promise<void> {
  const { trackId } = request.params;
  const track = await getPublishedTrack(trackId);
  return reply.send(success(track, MESSAGES.TRACK_RETRIEVED));
}

export async function createTrackHandler(
  request: FastifyRequest<{ Body: CreateTrackBody }>,
  reply: FastifyReply,
): Promise<void> {
  const body = CreateTrackSchema.parse(request.body);
  const userId = (request.user as JwtPayload | undefined)?.sub ?? '';
  const track = await createTrack(body, userId);
  return reply.status(201).send(created(track, MESSAGES.TRACK_CREATED));
}

export async function updateTrackHandler(
  request: FastifyRequest<{ Params: AdminTrackParams; Body: UpdateTrackBody }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;
  const body = UpdateTrackSchema.parse(request.body);
  const track = await updateTrack(id, body);
  return reply.send(success(track, 'Track updated successfully'));
}
