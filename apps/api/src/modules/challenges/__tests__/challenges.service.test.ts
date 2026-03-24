import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/repositories', () => ({
  challengesRepository: {
    findPublishedVersionById: vi.fn(),
    findPublishedVersionDetailById: vi.fn(),
    findQueryExecution: vi.fn(),
    countAttempts: vi.fn(),
    createAttempt: vi.fn(),
    findAttemptById: vi.fn(),
    getSessionUserId: vi.fn(),
    listAttemptsForUser: vi.fn(),
    listAttemptsForChallengeVersion: vi.fn(),
    createChallenge: vi.fn(),
    createVersion: vi.fn(),
    findVersionById: vi.fn(),
    publishVersion: vi.fn(),
  },
  lessonsRepository: {
    existsById: vi.fn(),
  },
}));

import { challengesRepository } from '../../../db/repositories';
import {
  getChallengeLeaderboard,
  getChallengeVersionDetail,
  listUserAttempts,
} from '../challenges.service';
import { NotFoundError } from '../../../lib/errors';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getChallengeVersionDetail()', () => {
  it('returns normalized published challenge details', async () => {
    vi.mocked(challengesRepository.findPublishedVersionDetailById).mockResolvedValue({
      id: 'challenge-version-1',
      challengeId: 'challenge-1',
      lessonId: 'lesson-1',
      slug: 'filter-active-users',
      title: 'Filter active users',
      description: null,
      difficulty: 'intermediate',
      sortOrder: 1,
      problemStatement: 'Return only active users.',
      hintText: null,
      expectedResultColumns: ['id', 'email', 123] as unknown,
      validatorType: 'result_set',
      publishedAt: new Date('2026-03-24T00:00:00.000Z'),
      createdAt: new Date('2026-03-20T00:00:00.000Z'),
    });

    const result = await getChallengeVersionDetail('challenge-version-1');

    expect(result).toEqual(
      expect.objectContaining({
        id: 'challenge-version-1',
        description: '',
        hintText: null,
        expectedResultColumns: ['id', 'email'],
        validatorType: 'result_set',
      }),
    );
  });

  it('throws when the challenge version is not published', async () => {
    vi.mocked(challengesRepository.findPublishedVersionDetailById).mockResolvedValue(null);

    await expect(getChallengeVersionDetail('missing')).rejects.toThrow(NotFoundError);
  });
});

describe('listUserAttempts()', () => {
  it('maps personal attempt history with query execution metadata', async () => {
    vi.mocked(challengesRepository.findPublishedVersionDetailById).mockResolvedValue({
      id: 'challenge-version-1',
      challengeId: 'challenge-1',
      lessonId: 'lesson-1',
      slug: 'filter-active-users',
      title: 'Filter active users',
      description: 'desc',
      difficulty: 'intermediate',
      sortOrder: 1,
      problemStatement: 'Return only active users.',
      hintText: 'Filter by active flag',
      expectedResultColumns: ['id', 'email'],
      validatorType: 'result_set',
      publishedAt: new Date('2026-03-24T00:00:00.000Z'),
      createdAt: new Date('2026-03-20T00:00:00.000Z'),
    });
    vi.mocked(challengesRepository.listAttemptsForUser).mockResolvedValue([
      {
        id: 'attempt-1',
        learningSessionId: 'session-1',
        challengeVersionId: 'challenge-version-1',
        queryExecutionId: 'query-1',
        attemptNo: 2,
        status: 'passed',
        score: 100,
        evaluation: { isCorrect: true, score: 100, feedbackText: 'Correct!' },
        submittedAt: new Date('2026-03-24T00:00:00.000Z'),
        sqlText: 'SELECT id, email FROM users WHERE active = true;',
        queryStatus: 'succeeded',
        rowsReturned: 42,
        durationMs: 18,
      },
    ]);

    const result = await listUserAttempts('challenge-version-1', 'user-1');

    expect(result).toEqual([
      expect.objectContaining({
        id: 'attempt-1',
        attemptNo: 2,
        status: 'passed',
        score: 100,
        queryExecution: expect.objectContaining({
          sqlText: 'SELECT id, email FROM users WHERE active = true;',
          status: 'succeeded',
          rowsReturned: 42,
          durationMs: 18,
        }),
      }),
    ]);
  });
});

describe('getChallengeLeaderboard()', () => {
  it('aggregates best score per user and sorts ties by earlier best submission', async () => {
    vi.mocked(challengesRepository.findPublishedVersionDetailById).mockResolvedValue({
      id: 'challenge-version-1',
      challengeId: 'challenge-1',
      lessonId: 'lesson-1',
      slug: 'filter-active-users',
      title: 'Filter active users',
      description: 'desc',
      difficulty: 'intermediate',
      sortOrder: 1,
      problemStatement: 'Return only active users.',
      hintText: null,
      expectedResultColumns: ['id', 'email'],
      validatorType: 'result_set',
      publishedAt: new Date('2026-03-24T00:00:00.000Z'),
      createdAt: new Date('2026-03-20T00:00:00.000Z'),
    });
    vi.mocked(challengesRepository.listAttemptsForChallengeVersion).mockResolvedValue([
      {
        userId: 'user-1',
        username: 'alice',
        displayName: 'Alice',
        avatarUrl: null,
        score: 95,
        status: 'passed',
        submittedAt: new Date('2026-03-24T00:10:00.000Z'),
      },
      {
        userId: 'user-2',
        username: 'bob',
        displayName: 'Bob',
        avatarUrl: null,
        score: 95,
        status: 'passed',
        submittedAt: new Date('2026-03-24T00:05:00.000Z'),
      },
      {
        userId: 'user-1',
        username: 'alice',
        displayName: 'Alice',
        avatarUrl: null,
        score: 30,
        status: 'failed',
        submittedAt: new Date('2026-03-24T00:02:00.000Z'),
      },
    ]);

    const result = await getChallengeLeaderboard('challenge-version-1', 10);

    expect(result).toEqual([
      expect.objectContaining({
        rank: 1,
        userId: 'user-2',
        bestScore: 95,
        attemptsCount: 1,
        passedAttempts: 1,
      }),
      expect.objectContaining({
        rank: 2,
        userId: 'user-1',
        bestScore: 95,
        attemptsCount: 2,
        passedAttempts: 1,
      }),
    ]);
  });
});
