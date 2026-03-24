import { challengesRepository, lessonsRepository } from '../../db/repositories';
import type {
  ChallengeRow,
  ChallengeVersionRow,
  ChallengeAttemptRow,
  ChallengeAttemptWithExecutionRow,
  ChallengeLeaderboardAttemptRow,
  PublishedChallengeVersionDetailRow,
} from '../../db/repositories';
import { NotFoundError, ForbiddenError } from '../../lib/errors';
import type { SubmitAttemptBody, CreateChallengeBody } from './challenges.schema';

export interface AttemptEvaluation {
  isCorrect: boolean;
  score: number;
  feedbackText: string;
}

export interface AttemptResult {
  id: string;
  attemptNo: number;
  status: string;
  score: number | null;
  evaluation: unknown;
  submittedAt: Date;
}

export interface CreateChallengeResult {
  challenge: ChallengeRow;
  version: ChallengeVersionRow;
}

export interface ChallengeVersionDetail {
  id: string;
  challengeId: string;
  lessonId: string;
  slug: string;
  title: string;
  description: string;
  difficulty: ChallengeRow['difficulty'];
  sortOrder: number;
  problemStatement: string;
  hintText: string | null;
  expectedResultColumns: string[];
  validatorType: string;
  publishedAt: Date | null;
  createdAt: Date;
}

export interface ChallengeAttemptListItem {
  id: string;
  learningSessionId: string;
  challengeVersionId: string;
  queryExecutionId: string;
  attemptNo: number;
  status: string;
  score: number | null;
  evaluation: unknown;
  submittedAt: Date;
  queryExecution: {
    sqlText: string;
    status: string;
    rowsReturned: number | null;
    durationMs: number | null;
  };
}

export interface ChallengeLeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bestScore: number;
  attemptsCount: number;
  passedAttempts: number;
  lastSubmittedAt: Date;
}

function normalizeChallengeVersionDetail(
  row: PublishedChallengeVersionDetailRow,
): ChallengeVersionDetail {
  return {
    ...row,
    description: row.description ?? '',
    hintText: row.hintText ?? null,
    expectedResultColumns: Array.isArray(row.expectedResultColumns)
      ? row.expectedResultColumns.filter((value): value is string => typeof value === 'string')
      : [],
  };
}

function mapAttemptRow(row: ChallengeAttemptWithExecutionRow): ChallengeAttemptListItem {
  return {
    id: row.id,
    learningSessionId: row.learningSessionId,
    challengeVersionId: row.challengeVersionId,
    queryExecutionId: row.queryExecutionId,
    attemptNo: row.attemptNo,
    status: row.status,
    score: row.score,
    evaluation: row.evaluation,
    submittedAt: row.submittedAt,
    queryExecution: {
      sqlText: row.sqlText,
      status: row.queryStatus,
      rowsReturned: row.rowsReturned,
      durationMs: row.durationMs,
    },
  };
}

function buildLeaderboard(
  rows: ChallengeLeaderboardAttemptRow[],
  limit: number,
): ChallengeLeaderboardEntry[] {
  const byUser = new Map<
    string,
    Omit<ChallengeLeaderboardEntry, 'rank'> & { bestSubmittedAt: Date }
  >();

  for (const row of rows) {
    const displayName = row.displayName ?? row.username;
    const score = row.score ?? 0;
    const existing = byUser.get(row.userId);

    if (!existing) {
      byUser.set(row.userId, {
        userId: row.userId,
        username: row.username,
        displayName,
        avatarUrl: row.avatarUrl,
        bestScore: score,
        attemptsCount: 1,
        passedAttempts: row.status === 'passed' ? 1 : 0,
        lastSubmittedAt: row.submittedAt,
        bestSubmittedAt: row.submittedAt,
      });
      continue;
    }

    existing.attemptsCount += 1;
    existing.lastSubmittedAt =
      existing.lastSubmittedAt > row.submittedAt ? existing.lastSubmittedAt : row.submittedAt;
    if (row.status === 'passed') {
      existing.passedAttempts += 1;
    }
    if (
      score > existing.bestScore ||
      (score === existing.bestScore && row.submittedAt < existing.bestSubmittedAt)
    ) {
      existing.bestScore = score;
      existing.bestSubmittedAt = row.submittedAt;
    }
  }

  return Array.from(byUser.values())
    .sort((a, b) => {
      if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
      return a.bestSubmittedAt.getTime() - b.bestSubmittedAt.getTime();
    })
    .slice(0, limit)
    .map((entry, index) => ({
      rank: index + 1,
      userId: entry.userId,
      username: entry.username,
      displayName: entry.displayName,
      avatarUrl: entry.avatarUrl,
      bestScore: entry.bestScore,
      attemptsCount: entry.attemptsCount,
      passedAttempts: entry.passedAttempts,
      lastSubmittedAt: entry.lastSubmittedAt,
    }));
}

export function evaluateAttempt(
  challengeVersion: {
    validatorType: string;
    validatorConfig: unknown;
    expectedResultColumns: unknown;
    referenceSolution: string | null;
  },
  queryExecution: {
    status: string;
    resultPreview: unknown;
    rowsReturned: number | null;
    errorMessage: string | null;
  },
): AttemptEvaluation {
  if (queryExecution.status !== 'succeeded') {
    return {
      isCorrect: false,
      score: 0,
      feedbackText: `Query execution failed: ${queryExecution.errorMessage ?? 'Unknown error'}`,
    };
  }

  if (challengeVersion.validatorType === 'result_set') {
    const expectedColumns = challengeVersion.expectedResultColumns as string[] | null;
    const resultPreview = queryExecution.resultPreview as {
      columns?: string[];
      rows?: unknown[][];
    } | null;

    if (!resultPreview?.columns) {
      return {
        isCorrect: false,
        score: 0,
        feedbackText: 'No results returned',
      };
    }

    if (expectedColumns && expectedColumns.length > 0) {
      const hasAllColumns = expectedColumns.every((col) =>
        resultPreview.columns?.includes(col),
      );

      if (!hasAllColumns) {
        return {
          isCorrect: false,
          score: 30,
          feedbackText: `Expected columns: ${expectedColumns.join(', ')}. Got: ${resultPreview.columns.join(', ')}`,
        };
      }
    }

    return {
      isCorrect: true,
      score: 100,
      feedbackText: 'Correct! Great work.',
    };
  }

  return {
    isCorrect: true,
    score: 100,
    feedbackText: 'Attempt evaluated successfully',
  };
}

export async function submitAttempt(
  data: SubmitAttemptBody,
  userId: string,
): Promise<AttemptResult> {
  // Validate session ownership
  const sessionUserId = await challengesRepository.getSessionUserId(data.learningSessionId);

  if (!sessionUserId) {
    throw new NotFoundError('Learning session not found');
  }

  if (sessionUserId !== userId) {
    throw new ForbiddenError('Access denied to this session');
  }

  // Validate challenge version exists and is published
  const challengeVersion = await challengesRepository.findPublishedVersionById(data.challengeVersionId);

  if (!challengeVersion) {
    throw new NotFoundError('Challenge version not found or not published');
  }

  // Validate query execution belongs to session and user
  const queryExecution = await challengesRepository.findQueryExecution(
    data.queryExecutionId,
    data.learningSessionId,
    userId,
  );

  if (!queryExecution) {
    throw new NotFoundError('Query execution not found or does not belong to this session');
  }

  // Count existing attempts, increment
  const existingCount = await challengesRepository.countAttempts(
    data.learningSessionId,
    data.challengeVersionId,
  );
  const attemptNo = existingCount + 1;

  // Evaluate attempt
  const evaluation = evaluateAttempt(challengeVersion, queryExecution);

  // Create attempt record
  const attempt = await challengesRepository.createAttempt({
    learningSessionId: data.learningSessionId,
    challengeVersionId: data.challengeVersionId,
    queryExecutionId: data.queryExecutionId,
    attemptNo,
    status: evaluation.isCorrect ? 'passed' : 'failed',
    score: evaluation.score,
    evaluation: evaluation as unknown as Record<string, unknown>,
  });

  return {
    id: attempt.id,
    attemptNo: attempt.attemptNo,
    status: attempt.status,
    score: attempt.score,
    evaluation: attempt.evaluation,
    submittedAt: attempt.submittedAt,
  };
}

export async function getChallengeVersionDetail(id: string): Promise<ChallengeVersionDetail> {
  const detail = await challengesRepository.findPublishedVersionDetailById(id);

  if (!detail) {
    throw new NotFoundError('Challenge version not found or not published');
  }

  return normalizeChallengeVersionDetail(detail);
}

export async function listUserAttempts(
  challengeVersionId: string,
  userId: string,
): Promise<ChallengeAttemptListItem[]> {
  const detail = await challengesRepository.findPublishedVersionDetailById(challengeVersionId);

  if (!detail) {
    throw new NotFoundError('Challenge version not found or not published');
  }

  const attempts = await challengesRepository.listAttemptsForUser(userId, challengeVersionId);
  return attempts.map(mapAttemptRow);
}

export async function getChallengeLeaderboard(
  challengeVersionId: string,
  limit = 10,
): Promise<ChallengeLeaderboardEntry[]> {
  const detail = await challengesRepository.findPublishedVersionDetailById(challengeVersionId);

  if (!detail) {
    throw new NotFoundError('Challenge version not found or not published');
  }

  const attempts = await challengesRepository.listAttemptsForChallengeVersion(challengeVersionId);
  return buildLeaderboard(attempts, limit);
}

export async function getAttempt(
  id: string,
  userId: string,
  isAdmin: boolean,
): Promise<ChallengeAttemptRow> {
  const attempt = await challengesRepository.findAttemptById(id);

  if (!attempt) {
    throw new NotFoundError('Challenge attempt not found');
  }

  const sessionUserId = await challengesRepository.getSessionUserId(attempt.learningSessionId);

  if (sessionUserId !== userId && !isAdmin) {
    throw new ForbiddenError('Access denied to this attempt');
  }

  return attempt;
}

export async function createChallenge(
  data: CreateChallengeBody,
  userId: string,
): Promise<CreateChallengeResult> {
  const lessonExists = await lessonsRepository.existsById(data.lessonId);

  if (!lessonExists) {
    throw new NotFoundError('Lesson not found');
  }

  const challenge = await challengesRepository.createChallenge({
    lessonId: data.lessonId,
    slug: data.slug,
    title: data.title,
    description: data.description,
    difficulty: data.difficulty,
    sortOrder: data.sortOrder,
  });

  const version = await challengesRepository.createVersion({
    challengeId: challenge.id,
    versionNo: 1,
    problemStatement: data.problemStatement,
    hintText: data.hintText,
    expectedResultColumns: data.expectedResultColumns as unknown as Record<string, unknown>,
    referenceSolution: data.referenceSolution,
    validatorType: data.validatorType,
    validatorConfig: data.validatorConfig as unknown as Record<string, unknown>,
    createdBy: userId,
  });

  return { challenge, version };
}

export async function publishChallengeVersion(versionId: string): Promise<ChallengeVersionRow> {
  const version = await challengesRepository.findVersionById(versionId);

  if (!version) {
    throw new NotFoundError('Challenge version not found');
  }

  const published = await challengesRepository.publishVersion(versionId, version.challengeId);

  if (!published) {
    throw new NotFoundError('Challenge version not found');
  }

  return published;
}
