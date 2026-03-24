import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../db/repositories', () => ({
  challengesRepository: {
    findPublishedVersionById: vi.fn(),
    findPublishedVersionDetailById: vi.fn(),
    findQueryExecution: vi.fn(),
    listSessionExecutions: vi.fn(),
    countAttempts: vi.fn(),
    createAttempt: vi.fn(),
    findAttemptById: vi.fn(),
    getSessionUserId: vi.fn(),
    listAttemptsForUser: vi.fn(),
    listAttemptsForChallengeVersion: vi.fn(),
    listPublishedChallenges: vi.fn(),
    listChallengesForUser: vi.fn(),
    listChallengesForReview: vi.fn(),
    createChallenge: vi.fn(),
    createVersion: vi.fn(),
    findVersionById: vi.fn(),
    publishVersion: vi.fn(),
  },
  sandboxesRepository: {
    findById: vi.fn(),
  },
  lessonsRepository: {
    existsById: vi.fn(),
  },
}));

vi.mock('../../../services/query-executor', () => ({
  executeSql: vi.fn(),
  getExplainPlan: vi.fn(),
}));

import { challengesRepository, sandboxesRepository } from '../../../db/repositories';
import { executeSql, getExplainPlan } from '../../../services/query-executor';
import {
  getChallengeLeaderboard,
  getChallengeVersionDetail,
  listPublishedChallenges,
  listReviewChallenges,
  listUserChallenges,
  listUserAttempts,
  submitAttempt,
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
      points: 100,
      problemStatement: 'Return only active users.',
      hintText: null,
      expectedResultColumns: ['id', 'email', 123] as unknown,
      validatorType: 'result_set',
      validatorConfig: null,
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
      points: 100,
      problemStatement: 'Return only active users.',
      hintText: 'Filter by active flag',
      expectedResultColumns: ['id', 'email'],
      validatorType: 'result_set',
      validatorConfig: null,
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

describe('submitAttempt()', () => {
  it('returns correctness, performance, and index breakdown for optimization challenges', async () => {
    vi.mocked(challengesRepository.getSessionUserId).mockResolvedValue('user-1');
    vi.mocked(challengesRepository.findPublishedVersionById).mockResolvedValue({
      id: 'challenge-version-1',
      challengeId: 'challenge-1',
      versionNo: 1,
      problemStatement: 'Return active users quickly.',
      hintText: null,
      expectedResultColumns: ['id', 'email'],
      referenceSolution: 'SELECT id, email FROM users WHERE active = true;',
      validatorType: 'result_set',
      validatorConfig: {
        baselineDurationMs: 200,
        requiresIndexOptimization: true,
      },
      isPublished: true,
      publishedAt: new Date('2026-03-24T00:00:00.000Z'),
      createdBy: 'user-1',
      createdAt: new Date('2026-03-20T00:00:00.000Z'),
      points: 200,
    } as never);
    vi.mocked(challengesRepository.findQueryExecution).mockResolvedValue({
      id: 'query-1',
      learningSessionId: 'session-1',
      sandboxInstanceId: 'sandbox-1',
      userId: 'user-1',
      sqlText: 'SELECT id, email FROM users WHERE active = true;',
      normalizedSql: null,
      status: 'succeeded',
      durationMs: 100,
      rowsReturned: 1,
      rowsScanned: 420,
      resultPreview: {
        columns: ['id', 'email'],
        rows: [{ id: 1, email: 'ada@example.com' }],
        totalRows: 1,
        truncated: false,
      },
      errorMessage: null,
      errorCode: null,
      submittedAt: new Date('2026-03-24T00:05:00.000Z'),
    } as never);
    vi.mocked(sandboxesRepository.findById).mockResolvedValue({
      id: 'sandbox-1',
      learningSessionId: 'session-1',
      schemaTemplateId: 'schema-1',
      datasetTemplateId: null,
      status: 'ready',
      containerRef: 'sandbox-1',
      dbName: 's_session1',
      expiresAt: new Date('2026-03-24T02:05:00.000Z'),
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      updatedAt: new Date('2026-03-24T00:05:00.000Z'),
    } as never);
    vi.mocked(executeSql).mockResolvedValue({
      columns: ['id', 'email'],
      rows: [[1, 'ada@example.com']],
      rowCount: 1,
      truncated: false,
      durationMs: 90,
    });
    vi.mocked(getExplainPlan).mockResolvedValue({
      rawPlan: {
        Plan: {
          'Node Type': 'Index Scan',
          'Actual Total Time': 90,
        },
      },
      planSummary: {
        nodeType: 'Index Scan',
        actualTime: 90,
      },
    });
    vi.mocked(challengesRepository.listSessionExecutions).mockResolvedValue([
      {
        id: 'query-0',
        sqlText: 'CREATE INDEX idx_users_active ON users(active);',
        status: 'succeeded',
        durationMs: 18,
        submittedAt: new Date('2026-03-24T00:02:00.000Z'),
      },
      {
        id: 'query-1',
        sqlText: 'SELECT id, email FROM users WHERE active = true;',
        status: 'succeeded',
        durationMs: 100,
        submittedAt: new Date('2026-03-24T00:05:00.000Z'),
      },
    ] as never);
    vi.mocked(challengesRepository.countAttempts).mockResolvedValue(0);
    vi.mocked(challengesRepository.createAttempt).mockImplementation(async (data) => ({
      id: 'attempt-1',
      submittedAt: new Date('2026-03-24T00:06:00.000Z'),
      ...data,
    }) as never);

    const result = await submitAttempt(
      {
        learningSessionId: 'session-1',
        challengeVersionId: 'challenge-version-1',
        queryExecutionId: 'query-1',
      },
      'user-1',
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: 'passed',
        score: 200,
        evaluation: expect.objectContaining({
          isCorrect: true,
          correctnessScore: 100,
          performanceScore: 70,
          indexScore: 30,
          usedIndexing: true,
          baselineDurationMs: 200,
          latestDurationMs: 100,
        }),
      }),
    );
  });

  it('fails the attempt when the submitted result rows do not match the reference solution', async () => {
    vi.mocked(challengesRepository.getSessionUserId).mockResolvedValue('user-1');
    vi.mocked(challengesRepository.findPublishedVersionById).mockResolvedValue({
      id: 'challenge-version-1',
      challengeId: 'challenge-1',
      versionNo: 1,
      problemStatement: 'Return active users.',
      hintText: null,
      expectedResultColumns: ['id', 'email'],
      referenceSolution: 'SELECT id, email FROM users WHERE active = true ORDER BY id;',
      validatorType: 'result_set',
      validatorConfig: null,
      isPublished: true,
      publishedAt: new Date('2026-03-24T00:00:00.000Z'),
      createdBy: 'user-1',
      createdAt: new Date('2026-03-20T00:00:00.000Z'),
      points: 100,
    } as never);
    vi.mocked(challengesRepository.findQueryExecution).mockResolvedValue({
      id: 'query-1',
      learningSessionId: 'session-1',
      sandboxInstanceId: 'sandbox-1',
      userId: 'user-1',
      sqlText: 'SELECT id, email FROM users WHERE active = true;',
      normalizedSql: null,
      status: 'succeeded',
      durationMs: 44,
      rowsReturned: 1,
      rowsScanned: 10,
      resultPreview: {
        columns: ['id', 'email'],
        rows: [[999, 'wrong@example.com']],
        truncated: false,
      },
      errorMessage: null,
      errorCode: null,
      submittedAt: new Date('2026-03-24T00:05:00.000Z'),
    } as never);
    vi.mocked(sandboxesRepository.findById).mockResolvedValue({
      id: 'sandbox-1',
      learningSessionId: 'session-1',
      schemaTemplateId: 'schema-1',
      datasetTemplateId: null,
      status: 'ready',
      containerRef: 'sandbox-1',
      dbName: 's_session1',
      expiresAt: new Date('2026-03-24T02:05:00.000Z'),
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      updatedAt: new Date('2026-03-24T00:05:00.000Z'),
    } as never);
    vi.mocked(executeSql).mockResolvedValue({
      columns: ['id', 'email'],
      rows: [[1, 'ada@example.com']],
      rowCount: 1,
      truncated: false,
      durationMs: 12,
    });
    vi.mocked(challengesRepository.listSessionExecutions).mockResolvedValue([
      {
        id: 'query-1',
        sqlText: 'SELECT id, email FROM users WHERE active = true;',
        status: 'succeeded',
        durationMs: 44,
        submittedAt: new Date('2026-03-24T00:05:00.000Z'),
      },
    ] as never);
    vi.mocked(challengesRepository.countAttempts).mockResolvedValue(0);
    vi.mocked(challengesRepository.createAttempt).mockImplementation(async (data) => ({
      id: 'attempt-2',
      submittedAt: new Date('2026-03-24T00:06:00.000Z'),
      ...data,
    }) as never);

    const result = await submitAttempt(
      {
        learningSessionId: 'session-1',
        challengeVersionId: 'challenge-version-1',
        queryExecutionId: 'query-1',
      },
      'user-1',
    );

    expect(result.status).toBe('failed');
    expect(result.score).toBe(0);
    expect(result.evaluation).toEqual(
      expect.objectContaining({
        isCorrect: false,
        correctnessScore: 0,
        feedbackText: expect.stringMatching(/result set/i),
      }),
    );
    expect(executeSql).toHaveBeenCalledWith(
      expect.stringContaining('/s_session1'),
      'SELECT id, email FROM users WHERE active = true ORDER BY id;',
      expect.any(Object),
    );
  });

  it('does not award index score from history alone when the explain plan does not use an index', async () => {
    vi.mocked(challengesRepository.getSessionUserId).mockResolvedValue('user-1');
    vi.mocked(challengesRepository.findPublishedVersionById).mockResolvedValue({
      id: 'challenge-version-1',
      challengeId: 'challenge-1',
      versionNo: 1,
      problemStatement: 'Return active users quickly.',
      hintText: null,
      expectedResultColumns: ['id', 'email'],
      referenceSolution: 'SELECT id, email FROM users WHERE active = true;',
      validatorType: 'result_set',
      validatorConfig: {
        baselineDurationMs: 200,
        requiresIndexOptimization: true,
      },
      isPublished: true,
      publishedAt: new Date('2026-03-24T00:00:00.000Z'),
      createdBy: 'user-1',
      createdAt: new Date('2026-03-20T00:00:00.000Z'),
      points: 200,
    } as never);
    vi.mocked(challengesRepository.findQueryExecution).mockResolvedValue({
      id: 'query-1',
      learningSessionId: 'session-1',
      sandboxInstanceId: 'sandbox-1',
      userId: 'user-1',
      sqlText: 'SELECT id, email FROM users WHERE active = true;',
      normalizedSql: null,
      status: 'succeeded',
      durationMs: 100,
      rowsReturned: 1,
      rowsScanned: 420,
      resultPreview: {
        columns: ['id', 'email'],
        rows: [[1, 'ada@example.com']],
        truncated: false,
      },
      errorMessage: null,
      errorCode: null,
      submittedAt: new Date('2026-03-24T00:05:00.000Z'),
    } as never);
    vi.mocked(sandboxesRepository.findById).mockResolvedValue({
      id: 'sandbox-1',
      learningSessionId: 'session-1',
      schemaTemplateId: 'schema-1',
      datasetTemplateId: null,
      status: 'ready',
      containerRef: 'sandbox-1',
      dbName: 's_session1',
      expiresAt: new Date('2026-03-24T02:05:00.000Z'),
      createdAt: new Date('2026-03-24T00:00:00.000Z'),
      updatedAt: new Date('2026-03-24T00:05:00.000Z'),
    } as never);
    vi.mocked(executeSql).mockResolvedValue({
      columns: ['id', 'email'],
      rows: [[1, 'ada@example.com']],
      rowCount: 1,
      truncated: false,
      durationMs: 90,
    });
    vi.mocked(getExplainPlan).mockResolvedValue({
      rawPlan: {
        Plan: {
          'Node Type': 'Seq Scan',
          'Actual Total Time': 100,
        },
      },
      planSummary: {
        nodeType: 'Seq Scan',
        actualTime: 100,
      },
    });
    vi.mocked(challengesRepository.listSessionExecutions).mockResolvedValue([
      {
        id: 'query-0',
        sqlText: 'CREATE INDEX idx_users_active ON users(active);',
        status: 'succeeded',
        durationMs: 18,
        submittedAt: new Date('2026-03-24T00:02:00.000Z'),
      },
      {
        id: 'query-1',
        sqlText: 'SELECT id, email FROM users WHERE active = true;',
        status: 'succeeded',
        durationMs: 100,
        submittedAt: new Date('2026-03-24T00:05:00.000Z'),
      },
    ] as never);
    vi.mocked(challengesRepository.countAttempts).mockResolvedValue(0);
    vi.mocked(challengesRepository.createAttempt).mockImplementation(async (data) => ({
      id: 'attempt-3',
      submittedAt: new Date('2026-03-24T00:06:00.000Z'),
      ...data,
    }) as never);

    const result = await submitAttempt(
      {
        learningSessionId: 'session-1',
        challengeVersionId: 'challenge-version-1',
        queryExecutionId: 'query-1',
      },
      'user-1',
    );

    expect(result.evaluation).toEqual(
      expect.objectContaining({
        isCorrect: true,
        performanceScore: 70,
        indexScore: 0,
        usedIndexing: false,
      }),
    );
  });
});

describe('listPublishedChallenges()', () => {
  it('returns normalized challenge catalog items with points and lesson metadata', async () => {
    vi.mocked(challengesRepository.listPublishedChallenges).mockResolvedValue([
      {
        id: 'challenge-1',
        lessonId: 'lesson-1',
        lessonSlug: 'filtering',
        lessonTitle: 'Filtering',
        trackId: 'track-1',
        trackSlug: 'sql-fundamentals',
        trackTitle: 'SQL Fundamentals',
        slug: 'filter-active-users',
        title: 'Filter active users',
        description: null,
        difficulty: 'intermediate',
        sortOrder: 1,
        status: 'published',
        points: 200,
        publishedVersionId: 'challenge-version-1',
        latestVersionId: 'challenge-version-1',
        latestVersionNo: 1,
        validatorType: 'result_set',
        updatedAt: new Date('2026-03-24T00:00:00.000Z'),
        createdAt: new Date('2026-03-20T00:00:00.000Z'),
      },
    ] as never);

    const result = await listPublishedChallenges();

    expect(result).toEqual([
      expect.objectContaining({
        id: 'challenge-1',
        title: 'Filter active users',
        description: '',
        points: 200,
        lessonTitle: 'Filtering',
        trackTitle: 'SQL Fundamentals',
        validatorType: 'result_set',
      }),
    ]);
  });
});

describe('listUserChallenges()', () => {
  it('returns the current user challenge drafts with latest version metadata', async () => {
    vi.mocked(challengesRepository.listChallengesForUser).mockResolvedValue([
      {
        id: 'challenge-1',
        lessonId: 'lesson-1',
        lessonSlug: 'filtering',
        lessonTitle: 'Filtering',
        trackId: 'track-1',
        trackSlug: 'sql-fundamentals',
        trackTitle: 'SQL Fundamentals',
        slug: 'filter-active-users',
        title: 'Filter active users',
        description: 'Return only active users.',
        difficulty: 'intermediate',
        sortOrder: 1,
        status: 'draft',
        points: 200,
        publishedVersionId: null,
        latestVersionId: 'challenge-version-1',
        latestVersionNo: 1,
        validatorType: 'result_set',
        updatedAt: new Date('2026-03-24T00:00:00.000Z'),
        createdAt: new Date('2026-03-20T00:00:00.000Z'),
      },
    ] as never);

    const result = await listUserChallenges('user-1');

    expect(result).toEqual([
      expect.objectContaining({
        id: 'challenge-1',
        status: 'draft',
        points: 200,
        latestVersionId: 'challenge-version-1',
        trackTitle: 'SQL Fundamentals',
      }),
    ]);
  });
});

describe('listReviewChallenges()', () => {
  it('returns admin moderation entries with creator identity and latest draft version', async () => {
    vi.mocked(challengesRepository.listChallengesForReview).mockResolvedValue([
      {
        id: 'challenge-1',
        lessonId: 'lesson-1',
        lessonSlug: 'filtering',
        lessonTitle: 'Filtering',
        trackId: 'track-1',
        trackSlug: 'sql-fundamentals',
        trackTitle: 'SQL Fundamentals',
        slug: 'filter-active-users',
        title: 'Filter active users',
        description: 'Return only active users.',
        difficulty: 'intermediate',
        sortOrder: 1,
        status: 'draft',
        points: 200,
        publishedVersionId: null,
        latestVersionId: 'challenge-version-1',
        latestVersionNo: 1,
        validatorType: 'result_set',
        createdById: 'user-2',
        createdByUsername: 'alice',
        createdByDisplayName: 'Alice',
        updatedAt: new Date('2026-03-24T00:00:00.000Z'),
        createdAt: new Date('2026-03-20T00:00:00.000Z'),
      },
    ] as never);

    const result = await listReviewChallenges();

    expect(result).toEqual([
      expect.objectContaining({
        id: 'challenge-1',
        status: 'draft',
        latestVersionId: 'challenge-version-1',
        createdBy: expect.objectContaining({
          id: 'user-2',
          username: 'alice',
          displayName: 'Alice',
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
      points: 100,
      problemStatement: 'Return only active users.',
      hintText: null,
      expectedResultColumns: ['id', 'email'],
      validatorType: 'result_set',
      validatorConfig: null,
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
