import { challengesRepository, lessonsRepository } from '../../db/repositories';
import type {
  ChallengeAttemptRow,
  ChallengeAttemptWithExecutionRow,
  ChallengeCatalogRow,
  ChallengeLeaderboardAttemptRow,
  ChallengeRow,
  ChallengeVersionRow,
  PublishedChallengeVersionDetailRow,
  PublishedChallengeVersionRow,
  ReviewChallengeRow,
  SessionExecutionSummaryRow,
} from '../../db/repositories';
import { ForbiddenError, NotFoundError } from '../../lib/errors';
import type { CreateChallengeBody, SubmitAttemptBody } from './challenges.schema';

export interface AttemptEvaluation {
  isCorrect: boolean;
  score: number;
  correctnessScore: number;
  performanceScore: number;
  indexScore: number;
  feedbackText: string;
  pointsPossible: number;
  baselineDurationMs: number | null;
  latestDurationMs: number | null;
  usedIndexing: boolean;
}

export interface AttemptResult {
  id: string;
  attemptNo: number;
  status: string;
  score: number | null;
  evaluation: AttemptEvaluation;
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
  points: number;
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
  evaluation: AttemptEvaluation | null;
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

export interface ChallengeCatalogItem {
  id: string;
  lessonId: string;
  lessonSlug: string;
  lessonTitle: string;
  trackId: string;
  trackSlug: string;
  trackTitle: string;
  slug: string;
  title: string;
  description: string;
  difficulty: ChallengeRow['difficulty'];
  sortOrder: number;
  status: ChallengeRow['status'];
  points: number;
  publishedVersionId: string | null;
  latestVersionId: string | null;
  latestVersionNo: number | null;
  validatorType: string | null;
  updatedAt: Date;
  createdAt: Date;
}

export interface ChallengeReviewItem extends ChallengeCatalogItem {
  createdBy: {
    id: string | null;
    username: string | null;
    displayName: string | null;
  };
}

function normalizeDescription(value: string | null | undefined): string {
  return value ?? '';
}

function normalizeExpectedResultColumns(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((column): column is string => typeof column === 'string');
}

function normalizeChallengeVersionDetail(
  row: PublishedChallengeVersionDetailRow,
): ChallengeVersionDetail {
  return {
    ...row,
    description: normalizeDescription(row.description),
    hintText: row.hintText ?? null,
    expectedResultColumns: normalizeExpectedResultColumns(row.expectedResultColumns),
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
    evaluation: (row.evaluation as AttemptEvaluation | null) ?? null,
    submittedAt: row.submittedAt,
    queryExecution: {
      sqlText: row.sqlText,
      status: row.queryStatus,
      rowsReturned: row.rowsReturned,
      durationMs: row.durationMs,
    },
  };
}

function normalizeCatalogRow(row: ChallengeCatalogRow): ChallengeCatalogItem {
  return {
    ...row,
    description: normalizeDescription(row.description),
  };
}

function normalizeReviewRow(row: ReviewChallengeRow): ChallengeReviewItem {
  return {
    ...normalizeCatalogRow(row),
    createdBy: {
      id: row.createdById,
      username: row.createdByUsername,
      displayName: row.createdByDisplayName,
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

function isCreateIndexStatement(sqlText: string): boolean {
  return /^\s*create\s+(unique\s+)?index\b/i.test(sqlText);
}

function isDropIndexStatement(sqlText: string): boolean {
  return /^\s*drop\s+index\b/i.test(sqlText);
}

function detectIndexUsage(
  executions: SessionExecutionSummaryRow[],
  latestQueryId: string | undefined,
): boolean {
  let hasIndex = false;

  for (const execution of executions) {
    if (execution.id === latestQueryId) {
      break;
    }

    if (execution.status !== 'succeeded') {
      continue;
    }

    if (isCreateIndexStatement(execution.sqlText)) {
      hasIndex = true;
      continue;
    }

    if (isDropIndexStatement(execution.sqlText)) {
      hasIndex = false;
    }
  }

  return hasIndex;
}

function buildScoreWeights(
  totalPoints: number,
  includePerformance: boolean,
  includeIndex: boolean,
): { correctness: number; performance: number; index: number } {
  if (!includePerformance && !includeIndex) {
    return {
      correctness: totalPoints,
      performance: 0,
      index: 0,
    };
  }

  const correctness = Math.round(totalPoints * 0.5);

  if (includePerformance && includeIndex) {
    const performance = Math.round(totalPoints * 0.35);
    return {
      correctness,
      performance,
      index: Math.max(0, totalPoints - correctness - performance),
    };
  }

  const remainder = Math.max(0, totalPoints - correctness);
  return {
    correctness,
    performance: includePerformance ? remainder : 0,
    index: includeIndex ? remainder : 0,
  };
}

function buildFeedback(evaluation: AttemptEvaluation): string {
  if (!evaluation.isCorrect) {
    return evaluation.feedbackText;
  }

  const notes: string[] = ['Correct result set.'];

  if (evaluation.performanceScore > 0 && evaluation.baselineDurationMs) {
    notes.push(
      `Performance beat the ${evaluation.baselineDurationMs} ms baseline with ${evaluation.latestDurationMs ?? 'unknown'} ms.`,
    );
  } else if (evaluation.baselineDurationMs) {
    notes.push(
      `Result is correct, but the query is still slower than the ${evaluation.baselineDurationMs} ms target.`,
    );
  }

  if (evaluation.indexScore > 0) {
    notes.push('Index optimization detected.');
  } else if (evaluation.pointsPossible > evaluation.correctnessScore + evaluation.performanceScore) {
    notes.push('No index optimization detected yet.');
  }

  return notes.join(' ');
}

export function evaluateAttempt(
  challengeVersion: Pick<
    PublishedChallengeVersionRow,
    'validatorType' | 'validatorConfig' | 'expectedResultColumns' | 'referenceSolution' | 'points'
  >,
  queryExecution: {
    id?: string;
    status: string;
    resultPreview: unknown;
    rowsReturned: number | null;
    errorMessage: string | null;
    durationMs: number | null;
  },
  sessionExecutions: SessionExecutionSummaryRow[] = [],
): AttemptEvaluation {
  const config =
    challengeVersion.validatorConfig && typeof challengeVersion.validatorConfig === 'object'
      ? (challengeVersion.validatorConfig as Record<string, unknown>)
      : {};
  const baselineDurationMs =
    typeof config.baselineDurationMs === 'number' ? config.baselineDurationMs : null;
  const requiresIndexOptimization = config.requiresIndexOptimization === true;
  const totalPoints = Math.max(0, challengeVersion.points ?? 100);
  const weights = buildScoreWeights(
    totalPoints,
    baselineDurationMs !== null,
    requiresIndexOptimization,
  );

  if (queryExecution.status !== 'succeeded') {
    return {
      isCorrect: false,
      score: 0,
      correctnessScore: 0,
      performanceScore: 0,
      indexScore: 0,
      feedbackText: `Query execution failed: ${queryExecution.errorMessage ?? 'Unknown error'}`,
      pointsPossible: totalPoints,
      baselineDurationMs,
      latestDurationMs: queryExecution.durationMs ?? null,
      usedIndexing: false,
    };
  }

  const expectedColumns = normalizeExpectedResultColumns(challengeVersion.expectedResultColumns);
  const resultPreview = queryExecution.resultPreview as
    | {
        columns?: string[];
      }
    | null;

  if (challengeVersion.validatorType === 'result_set') {
    if (!resultPreview?.columns || resultPreview.columns.length === 0) {
      return {
        isCorrect: false,
        score: 0,
        correctnessScore: 0,
        performanceScore: 0,
        indexScore: 0,
        feedbackText: 'No results returned',
        pointsPossible: totalPoints,
        baselineDurationMs,
        latestDurationMs: queryExecution.durationMs ?? null,
        usedIndexing: false,
      };
    }

    if (expectedColumns.length > 0) {
      const hasAllColumns = expectedColumns.every((column) =>
        resultPreview.columns?.includes(column),
      );

      if (!hasAllColumns) {
        const correctnessScore = Math.min(weights.correctness, Math.round(totalPoints * 0.3));
        return {
          isCorrect: false,
          score: correctnessScore,
          correctnessScore,
          performanceScore: 0,
          indexScore: 0,
          feedbackText: `Expected columns: ${expectedColumns.join(', ')}. Got: ${resultPreview.columns.join(', ')}`,
          pointsPossible: totalPoints,
          baselineDurationMs,
          latestDurationMs: queryExecution.durationMs ?? null,
          usedIndexing: false,
        };
      }
    }
  }

  const latestDurationMs = queryExecution.durationMs ?? null;
  let performanceScore = 0;
  if (baselineDurationMs !== null && latestDurationMs !== null && weights.performance > 0) {
    const ratio = baselineDurationMs / Math.max(latestDurationMs, 1);
    performanceScore = Math.max(0, Math.round(weights.performance * Math.min(1, ratio)));
  }

  const usedIndexing =
    requiresIndexOptimization && weights.index > 0
      ? detectIndexUsage(sessionExecutions, queryExecution.id)
      : false;
  const indexScore = usedIndexing ? weights.index : 0;

  const evaluation: AttemptEvaluation = {
    isCorrect: true,
    score: weights.correctness + performanceScore + indexScore,
    correctnessScore: weights.correctness,
    performanceScore,
    indexScore,
    feedbackText: '',
    pointsPossible: totalPoints,
    baselineDurationMs,
    latestDurationMs,
    usedIndexing,
  };
  evaluation.feedbackText = buildFeedback(evaluation);

  return evaluation;
}

export async function submitAttempt(
  data: SubmitAttemptBody,
  userId: string,
): Promise<AttemptResult> {
  const sessionUserId = await challengesRepository.getSessionUserId(data.learningSessionId);

  if (!sessionUserId) {
    throw new NotFoundError('Learning session not found');
  }

  if (sessionUserId !== userId) {
    throw new ForbiddenError('Access denied to this session');
  }

  const challengeVersion = await challengesRepository.findPublishedVersionById(data.challengeVersionId);

  if (!challengeVersion) {
    throw new NotFoundError('Challenge version not found or not published');
  }

  const queryExecution = await challengesRepository.findQueryExecution(
    data.queryExecutionId,
    data.learningSessionId,
    userId,
  );

  if (!queryExecution) {
    throw new NotFoundError('Query execution not found or does not belong to this session');
  }

  const existingCount = await challengesRepository.countAttempts(
    data.learningSessionId,
    data.challengeVersionId,
  );
  const attemptNo = existingCount + 1;

  const sessionExecutions = await challengesRepository.listSessionExecutions(
    data.learningSessionId,
    userId,
  );
  const evaluation = evaluateAttempt(challengeVersion, queryExecution, sessionExecutions);

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
    evaluation,
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

export async function listPublishedChallenges(): Promise<ChallengeCatalogItem[]> {
  const challenges = await challengesRepository.listPublishedChallenges();
  return challenges.map(normalizeCatalogRow);
}

export async function listUserChallenges(userId: string): Promise<ChallengeCatalogItem[]> {
  const challenges = await challengesRepository.listChallengesForUser(userId);
  return challenges.map(normalizeCatalogRow);
}

export async function listReviewChallenges(): Promise<ChallengeReviewItem[]> {
  const challenges = await challengesRepository.listChallengesForReview();
  return challenges.map(normalizeReviewRow);
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
    points: data.points ?? 100,
    status: 'draft',
    createdBy: userId,
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
