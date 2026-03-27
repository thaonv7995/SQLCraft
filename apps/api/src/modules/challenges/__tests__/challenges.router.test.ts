import Fastify, { type FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';
import { ApiCode } from '@sqlcraft/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { errorHandler } from '../../../middleware/error-handler';
import authPlugin from '../../../plugins/auth';

const challengeServiceMocks = vi.hoisted(() => ({
  submitAttempt: vi.fn(),
  getAttempt: vi.fn(),
  getChallengeVersionDetail: vi.fn(),
  getEditableChallenge: vi.fn(),
  listPublishedChallenges: vi.fn(),
  listReviewChallenges: vi.fn(),
  listAdminChallengesCatalog: vi.fn(),
  listUserChallenges: vi.fn(),
  listUserAttempts: vi.fn(),
  getChallengeLeaderboard: vi.fn(),
  getChallengeLeaderboardContext: vi.fn(),
  getGlobalLeaderboard: vi.fn(),
  validateChallengeDraft: vi.fn(),
  createChallenge: vi.fn(),
  createChallengeVersion: vi.fn(),
  publishChallengeVersion: vi.fn(),
  reviewChallengeVersion: vi.fn(),
}));

vi.mock('../challenges.service', () => challengeServiceMocks);

import challengesRouter from '../challenges.router';

describe('challenges router HTTP contracts', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    challengeServiceMocks.submitAttempt.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      status: 'accepted',
    });
    challengeServiceMocks.getAttempt.mockResolvedValue({
      id: '33333333-3333-4333-8333-333333333333',
      status: 'passed',
    });
    challengeServiceMocks.getChallengeVersionDetail.mockResolvedValue({
      id: 'challenge-version-1',
    });
    challengeServiceMocks.getEditableChallenge.mockResolvedValue({
      id: 'challenge-1',
    });
    challengeServiceMocks.listPublishedChallenges.mockResolvedValue([]);
    challengeServiceMocks.listReviewChallenges.mockResolvedValue([]);
    challengeServiceMocks.listAdminChallengesCatalog.mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    challengeServiceMocks.listUserChallenges.mockResolvedValue([]);
    challengeServiceMocks.listUserAttempts.mockResolvedValue([]);
    challengeServiceMocks.getChallengeLeaderboard.mockResolvedValue([]);
    challengeServiceMocks.getChallengeLeaderboardContext.mockResolvedValue({
      entries: [],
      totalRankedUsers: 0,
      viewerRank: null,
      viewerEntry: null,
    });
    challengeServiceMocks.getGlobalLeaderboard.mockResolvedValue({ entries: [], viewer: null });
    challengeServiceMocks.validateChallengeDraft.mockResolvedValue({
      valid: true,
    });
    challengeServiceMocks.createChallenge.mockResolvedValue({
      id: 'challenge-1',
      slug: 'valid-challenge',
    });
    challengeServiceMocks.createChallengeVersion.mockResolvedValue({
      id: 'challenge-version-1',
    });
    challengeServiceMocks.publishChallengeVersion.mockResolvedValue({
      id: 'challenge-version-1',
      status: 'published',
    });
    challengeServiceMocks.reviewChallengeVersion.mockResolvedValue({
      id: 'challenge-version-1',
      decision: 'approve',
    });

    app = Fastify({ logger: false });
    await app.register(jwt, { secret: 'test-secret-test-secret-test-secret' });
    await app.register(authPlugin);
    app.setErrorHandler(errorHandler);
    await app.register(challengesRouter);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  const signToken = (roles: string[] = ['user'], subject = 'user-123') =>
    app.jwt.sign({
      sub: subject,
      email: `${subject}@example.com`,
      username: subject,
      roles,
    });

  it('validates result-set challenge drafts before creation reaches the service layer', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/challenges',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
      payload: {
        lessonId: '11111111-1111-4111-8111-111111111111',
        slug: 'valid-challenge',
        title: 'Valid Challenge',
        problemStatement: 'Return every row from users.',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(challengeServiceMocks.createChallenge).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      success: false,
      code: ApiCode.VALIDATION_ERROR,
      message: 'Validation failed',
    });
  });

  it('creates challenge attempts with the authenticated user context', async () => {
    const payload = {
      learningSessionId: '11111111-1111-4111-8111-111111111111',
      challengeVersionId: '22222222-2222-4222-8222-222222222222',
      queryExecutionId: '33333333-3333-4333-8333-333333333333',
    };

    const response = await app.inject({
      method: 'POST',
      url: '/v1/challenge-attempts',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
      payload,
    });

    expect(response.statusCode).toBe(201);
    expect(challengeServiceMocks.submitAttempt).toHaveBeenCalledWith(payload, 'user-123');
    expect(response.json()).toEqual({
      success: true,
      code: ApiCode.CREATED,
      message: 'Challenge attempt submitted',
      data: {
        id: '33333333-3333-4333-8333-333333333333',
        status: 'accepted',
      },
    });
  });

  it('returns challenge leaderboard context with viewer rank from JWT sub', async () => {
    challengeServiceMocks.getChallengeLeaderboardContext.mockResolvedValueOnce({
      entries: [
        {
          rank: 1,
          attemptId: 'a1',
          queryExecutionId: 'q1',
          userId: 'user-123',
          username: 'u',
          displayName: 'Me',
          avatarUrl: null,
          bestDurationMs: 12,
          bestTotalCost: 1.2,
          sqlText: 'select 1',
          attemptsCount: 1,
          passedAttempts: 1,
          lastSubmittedAt: new Date('2025-01-01'),
        },
      ],
      totalRankedUsers: 3,
      viewerRank: 2,
      viewerEntry: null,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/v1/challenge-versions/22222222-2222-4222-8222-222222222222/leaderboard/context?limit=15',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(challengeServiceMocks.getChallengeLeaderboardContext).toHaveBeenCalledWith(
      '22222222-2222-4222-8222-222222222222',
      15,
      'user-123',
    );
    const body = response.json() as { data: { totalRankedUsers: number; viewerRank: number } };
    expect(body.data.totalRankedUsers).toBe(3);
    expect(body.data.viewerRank).toBe(2);
  });

  it('coerces global leaderboard query parameters before calling the service', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/leaderboard?period=monthly&limit=5',
      headers: {
        authorization: `Bearer ${signToken()}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(challengeServiceMocks.getGlobalLeaderboard).toHaveBeenCalledWith('monthly', 5, 'user-123');
    expect(response.json()).toEqual({
      success: true,
      code: ApiCode.SUCCESS,
      message: 'Global leaderboard retrieved successfully',
      data: { entries: [], viewer: null },
    });
  });

  it('returns the admin challenges catalog for admins', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/challenges/catalog?page=2&limit=10&domain=ecommerce',
      headers: {
        authorization: `Bearer ${signToken(['admin'], 'admin-1')}`,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(challengeServiceMocks.listAdminChallengesCatalog).toHaveBeenCalledWith({
      page: 2,
      limit: 10,
      databaseId: undefined,
      domain: 'ecommerce',
      status: 'all',
    });
  });

  it('rejects admin challenges catalog for non-admins', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/admin/challenges/catalog',
      headers: {
        authorization: `Bearer ${signToken(['user'])}`,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(challengeServiceMocks.listAdminChallengesCatalog).not.toHaveBeenCalled();
  });

  it('enforces the admin role on review endpoints', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/challenge-versions/33333333-3333-4333-8333-333333333333/review',
      headers: {
        authorization: `Bearer ${signToken(['user'])}`,
      },
      payload: {
        decision: 'approve',
      },
    });

    expect(response.statusCode).toBe(403);
    expect(challengeServiceMocks.reviewChallengeVersion).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      success: false,
      code: ApiCode.FORBIDDEN,
      message: 'You do not have permission to access this resource',
    });
  });

  it('validates admin review decisions after passing the auth guard', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/admin/challenge-versions/33333333-3333-4333-8333-333333333333/review',
      headers: {
        authorization: `Bearer ${signToken(['admin'], 'admin-1')}`,
      },
      payload: {
        decision: 'ship-it',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(challengeServiceMocks.reviewChallengeVersion).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      success: false,
      code: ApiCode.VALIDATION_ERROR,
      message: 'Validation failed',
    });
  });
});
