import { challengesRepository, lessonsRepository, sandboxesRepository } from '../../db/repositories';
import type {
  ChallengeAttemptRow,
  ChallengeAttemptWithExecutionRow,
  ChallengeCatalogRow,
  EditableChallengeDetailRow,
  ChallengeLeaderboardAttemptRow,
  GlobalLeaderboardAttemptRow,
  ChallengeRow,
  ChallengeVersionRow,
  PublishedChallengeVersionDetailRow,
  PublishedChallengeVersionRow,
  ReviewChallengeRow,
  SessionExecutionSummaryRow,
} from '../../db/repositories';
import { ForbiddenError, NotFoundError, QueryExecutionFailedError, ValidationError } from '../../lib/errors';
import type { ExplainResult } from '../../services/query-executor';
import { executeSql, getExplainPlan, validateSql } from '../../services/query-executor';
import type {
  CreateChallengeBody,
  CreateChallengeVersionBody,
  ReviewChallengeVersionBody,
  SubmitAttemptBody,
  ValidateChallengeDraftBody,
} from './challenges.schema';

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

export interface ChallengeDraftValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalized: {
    slug: string;
    expectedResultColumns: string[];
    referenceSolution: string | null;
    validatorConfig: Record<string, unknown> | null;
  };
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
  validatorConfig: Record<string, unknown> | null;
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

export interface GlobalLeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  points: number;
  challengesCompleted: number;
  streak: number;
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
  latestVersionReviewStatus: ChallengeVersionRow['reviewStatus'] | null;
  latestVersionReviewNotes: string | null;
  latestVersionReviewedAt: Date | null;
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

export interface EditableChallengeDetail {
  id: string;
  lessonId: string;
  slug: string;
  title: string;
  description: string;
  difficulty: ChallengeRow['difficulty'];
  sortOrder: number;
  points: number;
  status: ChallengeRow['status'];
  publishedVersionId: string | null;
  updatedAt: Date;
  createdAt: Date;
  latestVersion: {
    id: string;
    versionNo: number;
    problemStatement: string;
    hintText: string | null;
    expectedResultColumns: string[];
    referenceSolution: string | null;
    validatorType: string;
    validatorConfig: Record<string, unknown> | null;
    isPublished: boolean;
    reviewStatus: ChallengeVersionRow['reviewStatus'];
    reviewNotes: string | null;
    reviewedBy: string | null;
    reviewedAt: Date | null;
    publishedAt: Date | null;
    createdAt: Date;
  };
}

interface NormalizedResultPreview {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
}

interface ResultSetReference {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
}

interface AttemptEvaluationContext {
  referenceResult?: ResultSetReference | null;
  explainPlan?: ExplainResult | null;
}

function normalizeDescription(value: string | null | undefined): string {
  return value ?? '';
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function normalizeExpectedResultColumns(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .filter((column): column is string => typeof column === 'string')
        .map((column) => column.trim())
        .filter(Boolean),
    ),
  );
}

function normalizeValidatorConfig(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const config = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  const baselineCandidate = config.baselineDurationMs;
  const baselineDurationMs =
    typeof baselineCandidate === 'number'
      ? baselineCandidate
      : typeof baselineCandidate === 'string'
        ? Number(baselineCandidate)
        : null;

  if (typeof baselineDurationMs === 'number' && Number.isFinite(baselineDurationMs)) {
    normalized.baselineDurationMs = baselineDurationMs;
  }

  if (config.requiresIndexOptimization === true) {
    normalized.requiresIndexOptimization = true;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function normalizeChallengeVersionDetail(
  row: PublishedChallengeVersionDetailRow,
): ChallengeVersionDetail {
  return {
    ...row,
    description: normalizeDescription(row.description),
    hintText: row.hintText ?? null,
    expectedResultColumns: normalizeExpectedResultColumns(row.expectedResultColumns),
    validatorConfig: normalizeValidatorConfig(row.validatorConfig),
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
    latestVersionReviewNotes: normalizeNullableText(row.latestVersionReviewNotes),
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

function normalizeEditableChallengeDetail(row: EditableChallengeDetailRow): EditableChallengeDetail {
  return {
    id: row.id,
    lessonId: row.lessonId,
    slug: row.slug,
    title: row.title,
    description: normalizeDescription(row.description),
    difficulty: row.difficulty,
    sortOrder: row.sortOrder,
    points: row.points,
    status: row.status,
    publishedVersionId: row.publishedVersionId,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt,
    latestVersion: {
      id: row.versionId,
      versionNo: row.versionNo,
      problemStatement: row.problemStatement,
      hintText: row.hintText ?? null,
      expectedResultColumns: normalizeExpectedResultColumns(row.expectedResultColumns),
      referenceSolution: normalizeNullableText(row.referenceSolution),
      validatorType: row.validatorType,
      validatorConfig: normalizeValidatorConfig(row.validatorConfig),
      isPublished: row.isPublished,
      reviewStatus: row.reviewStatus,
      reviewNotes: normalizeNullableText(row.reviewNotes),
      reviewedBy: row.reviewedBy,
      reviewedAt: row.reviewedAt,
      publishedAt: row.publishedAt,
      createdAt: row.versionCreatedAt,
    },
  };
}

interface NormalizedChallengeDraftPayload {
  lessonId: string;
  slug: string;
  title: string;
  description?: string;
  difficulty: ChallengeRow['difficulty'];
  sortOrder: number;
  points: number;
  problemStatement: string;
  hintText?: string;
  expectedResultColumns: string[];
  referenceSolution: string | null;
  validatorType: string;
  validatorConfig: Record<string, unknown> | null;
}

function normalizeChallengeDraftPayload(
  data: Pick<
    CreateChallengeBody,
    | 'lessonId'
    | 'slug'
    | 'title'
    | 'description'
    | 'difficulty'
    | 'sortOrder'
    | 'points'
    | 'problemStatement'
    | 'hintText'
    | 'expectedResultColumns'
    | 'referenceSolution'
    | 'validatorType'
    | 'validatorConfig'
  >,
): NormalizedChallengeDraftPayload {
  return {
    lessonId: data.lessonId,
    slug: data.slug.trim(),
    title: data.title.trim(),
    description: normalizeNullableText(data.description) ?? undefined,
    difficulty: data.difficulty,
    sortOrder: data.sortOrder,
    points: data.points ?? 100,
    problemStatement: data.problemStatement.trim(),
    hintText: normalizeNullableText(data.hintText) ?? undefined,
    expectedResultColumns: normalizeExpectedResultColumns(data.expectedResultColumns),
    referenceSolution: normalizeNullableText(data.referenceSolution),
    validatorType: data.validatorType,
    validatorConfig: normalizeValidatorConfig(data.validatorConfig),
  };
}

async function buildDraftValidation(
  data: ValidateChallengeDraftBody,
): Promise<ChallengeDraftValidationResult> {
  const normalized = normalizeChallengeDraftPayload(data);
  const errors: string[] = [];
  const warnings: string[] = [];

  const lessonExists = await lessonsRepository.existsById(normalized.lessonId);
  if (!lessonExists) {
    errors.push('Lesson not found.');
  }

  const existingChallenge = await challengesRepository.findByLessonAndSlug(
    normalized.lessonId,
    normalized.slug,
  );
  if (existingChallenge && existingChallenge.id !== data.challengeId) {
    errors.push('Slug already exists for this lesson.');
  }

  if (normalized.validatorType === 'result_set') {
    if (!normalized.referenceSolution) {
      errors.push('Reference solution is required for result_set challenges.');
    } else {
      const sqlValidation = validateSql(normalized.referenceSolution);
      if (!sqlValidation.valid) {
        errors.push(sqlValidation.reason ?? 'Reference solution is not allowed.');
      }
    }
  }

  if (normalized.expectedResultColumns.length === 0) {
    warnings.push('Expected result columns are empty, so preview checks will rely on the raw result set.');
  }

  if (!normalized.description) {
    warnings.push('Description is empty. Add a short teaching summary for reviewers.');
  }

  const baselineCandidate = normalized.validatorConfig?.baselineDurationMs;
  const baselineDurationMs =
    typeof baselineCandidate === 'number' ? baselineCandidate : null;

  if (baselineDurationMs !== null && baselineDurationMs <= 0) {
    errors.push('Baseline duration must be greater than 0 ms.');
  }

  if (
    normalized.validatorConfig?.requiresIndexOptimization === true &&
    baselineDurationMs === null
  ) {
    errors.push('Baseline duration is required when index optimization is enabled.');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalized: {
      slug: normalized.slug,
      expectedResultColumns: normalized.expectedResultColumns,
      referenceSolution: normalized.referenceSolution,
      validatorConfig: normalized.validatorConfig,
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

function toUtcDayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function computeRecentStreak(activityDays: Set<string>): number {
  if (activityDays.size === 0) {
    return 0;
  }

  const orderedDays = Array.from(activityDays).sort();
  const latestDay = orderedDays[orderedDays.length - 1];
  const cursor = new Date(`${latestDay}T00:00:00.000Z`);
  let streak = 0;

  while (activityDays.has(toUtcDayKey(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return streak;
}

function getGlobalLeaderboardSince(
  period: 'weekly' | 'monthly' | 'alltime',
): Date | undefined {
  if (period === 'alltime') {
    return undefined;
  }

  const now = new Date();
  const daysToSubtract = period === 'weekly' ? 7 : 30;
  now.setUTCDate(now.getUTCDate() - daysToSubtract);
  return now;
}

function buildGlobalLeaderboard(
  rows: GlobalLeaderboardAttemptRow[],
  limit: number,
): GlobalLeaderboardEntry[] {
  const byUser = new Map<
    string,
    Omit<GlobalLeaderboardEntry, 'rank'> & {
      challengeIds: Set<string>;
      activityDays: Set<string>;
      lastSubmittedAt: Date;
    }
  >();

  for (const row of rows) {
    const displayName = row.displayName ?? row.username;
    const existing = byUser.get(row.userId);

    if (!existing) {
      const challengeIds = new Set<string>([row.challengeId]);
      const activityDays = new Set<string>([toUtcDayKey(row.submittedAt)]);
      byUser.set(row.userId, {
        userId: row.userId,
        username: row.username,
        displayName,
        avatarUrl: row.avatarUrl,
        points: row.points,
        challengesCompleted: 1,
        streak: 0,
        challengeIds,
        activityDays,
        lastSubmittedAt: row.submittedAt,
      });
      continue;
    }

    existing.activityDays.add(toUtcDayKey(row.submittedAt));
    existing.lastSubmittedAt =
      existing.lastSubmittedAt > row.submittedAt ? existing.lastSubmittedAt : row.submittedAt;

    if (!existing.challengeIds.has(row.challengeId)) {
      existing.challengeIds.add(row.challengeId);
      existing.points += row.points;
      existing.challengesCompleted += 1;
    }
  }

  return Array.from(byUser.values())
    .map((entry) => ({
      ...entry,
      streak: computeRecentStreak(entry.activityDays),
    }))
    .sort((left, right) => {
      if (right.points !== left.points) return right.points - left.points;
      if (right.challengesCompleted !== left.challengesCompleted) {
        return right.challengesCompleted - left.challengesCompleted;
      }
      if (right.streak !== left.streak) return right.streak - left.streak;
      if (right.lastSubmittedAt.getTime() !== left.lastSubmittedAt.getTime()) {
        return right.lastSubmittedAt.getTime() - left.lastSubmittedAt.getTime();
      }
      return left.username.localeCompare(right.username);
    })
    .slice(0, limit)
    .map((entry, index) => ({
      rank: index + 1,
      userId: entry.userId,
      username: entry.username,
      displayName: entry.displayName,
      avatarUrl: entry.avatarUrl,
      points: entry.points,
      challengesCompleted: entry.challengesCompleted,
      streak: entry.streak,
    }));
}

function isCreateIndexStatement(sqlText: string): boolean {
  return /^\s*create\s+(unique\s+)?index\b/i.test(sqlText);
}

function isDropIndexStatement(sqlText: string): boolean {
  return /^\s*drop\s+index\b/i.test(sqlText);
}

function normalizeResultColumns(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((column): column is string => typeof column === 'string');
}

function normalizeResultRows(value: unknown): unknown[][] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((row) => {
    if (Array.isArray(row)) {
      return [row];
    }

    if (row && typeof row === 'object') {
      return [Object.values(row as Record<string, unknown>)];
    }

    return [];
  });
}

function normalizeResultPreview(value: unknown): NormalizedResultPreview {
  if (!value || typeof value !== 'object') {
    return { columns: [], rows: [], truncated: false };
  }

  const preview = value as {
    columns?: unknown;
    rows?: unknown;
    truncated?: unknown;
  };

  return {
    columns: normalizeResultColumns(preview.columns),
    rows: normalizeResultRows(preview.rows),
    truncated: preview.truncated === true,
  };
}

function normalizeComparableValue(value: unknown): unknown {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeComparableValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, normalizeComparableValue(entryValue)]),
    );
  }

  return value;
}

function serializeRow(row: unknown[]): string {
  return JSON.stringify(normalizeComparableValue(row));
}

function compareColumnLists(actual: string[], expected: string[]): boolean {
  if (actual.length !== expected.length) {
    return false;
  }

  return actual.every(
    (column, index) => column.trim().toLowerCase() === expected[index]?.trim().toLowerCase(),
  );
}

function compareResultSets(
  actualPreview: NormalizedResultPreview,
  actualRowCount: number | null,
  referenceResult: ResultSetReference,
): { matches: boolean; feedbackText?: string } {
  if (actualPreview.columns.length === 0) {
    return {
      matches: false,
      feedbackText: 'No results returned.',
    };
  }

  if (!compareColumnLists(actualPreview.columns, referenceResult.columns)) {
    return {
      matches: false,
      feedbackText: 'Result set columns do not match the reference solution.',
    };
  }

  if (actualPreview.truncated || referenceResult.truncated) {
    return {
      matches: false,
      feedbackText: 'Result set is truncated and cannot be validated safely.',
    };
  }

  const resolvedActualRowCount = actualRowCount ?? actualPreview.rows.length;
  if (resolvedActualRowCount !== referenceResult.rowCount) {
    return {
      matches: false,
      feedbackText: 'Result set row count does not match the reference solution.',
    };
  }

  const actualRows = actualPreview.rows.map((row) => serializeRow(row)).sort();
  const expectedRows = referenceResult.rows.map((row) => serializeRow(row)).sort();

  if (actualRows.length !== expectedRows.length) {
    return {
      matches: false,
      feedbackText: 'Result set row count does not match the reference solution.',
    };
  }

  const hasMismatch = actualRows.some((row, index) => row !== expectedRows[index]);
  if (hasMismatch) {
    return {
      matches: false,
      feedbackText: 'Result set does not match the reference solution.',
    };
  }

  return { matches: true };
}

function shouldExplainAnalyze(sqlText: string): boolean {
  return /^(select|with)\b/i.test(sqlText.trim());
}

function getSandboxRuntimeConfig(): {
  host: string;
  port: number;
  user: string;
  password: string;
  maxQueryTimeMs: number;
  maxRowsPreview: number;
} {
  return {
    host: process.env.SANDBOX_DB_HOST ?? 'localhost',
    port: Number(process.env.SANDBOX_DB_PORT ?? '5433'),
    user: process.env.SANDBOX_DB_USER ?? 'sandbox',
    password: process.env.SANDBOX_DB_PASSWORD ?? 'sandbox',
    maxQueryTimeMs: Number(process.env.SANDBOX_MAX_QUERY_TIME_MS ?? '30000'),
    maxRowsPreview: Number(process.env.SANDBOX_MAX_ROWS_PREVIEW ?? '500'),
  };
}

function planUsesIndex(rawPlan: unknown): boolean {
  if (!rawPlan || typeof rawPlan !== 'object') {
    return false;
  }

  const queue: unknown[] = [rawPlan];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') {
      continue;
    }

    const node = current as Record<string, unknown>;
    const planNode = (node.Plan as Record<string, unknown> | undefined) ?? node;
    const nodeType = typeof planNode['Node Type'] === 'string' ? planNode['Node Type'] : '';

    if (nodeType.toLowerCase().includes('index')) {
      return true;
    }

    if (Array.isArray(planNode.Plans)) {
      queue.push(...planNode.Plans);
    }
  }

  return false;
}

function detectIndexUsage(
  executions: SessionExecutionSummaryRow[],
  latestQueryId: string | undefined,
  explainPlan?: ExplainResult | null,
): boolean {
  if (!explainPlan || !planUsesIndex(explainPlan.rawPlan)) {
    return false;
  }

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
  context: AttemptEvaluationContext = {},
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
  const resultPreview = normalizeResultPreview(queryExecution.resultPreview);

  if (challengeVersion.validatorType === 'result_set') {
    if (resultPreview.columns.length === 0) {
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

    if (context.referenceResult) {
      const comparison = compareResultSets(
        resultPreview,
        queryExecution.rowsReturned ?? null,
        context.referenceResult,
      );

      if (!comparison.matches) {
        return {
          isCorrect: false,
          score: 0,
          correctnessScore: 0,
          performanceScore: 0,
          indexScore: 0,
          feedbackText: comparison.feedbackText ?? 'Result set does not match the reference solution.',
          pointsPossible: totalPoints,
          baselineDurationMs,
          latestDurationMs: queryExecution.durationMs ?? null,
          usedIndexing: false,
        };
      }
    } else if (expectedColumns.length > 0 && !compareColumnLists(resultPreview.columns, expectedColumns)) {
      return {
        isCorrect: false,
        score: 0,
        correctnessScore: 0,
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

  const latestDurationMs = queryExecution.durationMs ?? null;
  let performanceScore = 0;
  if (baselineDurationMs !== null && latestDurationMs !== null && weights.performance > 0) {
    const ratio = baselineDurationMs / Math.max(latestDurationMs, 1);
    performanceScore = Math.max(0, Math.round(weights.performance * Math.min(1, ratio)));
  }

  const usedIndexing =
    requiresIndexOptimization && weights.index > 0
      ? detectIndexUsage(sessionExecutions, queryExecution.id, context.explainPlan)
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

function buildSandboxConnectionString(params: {
  dbName: string;
  containerRef: string | null;
}): string {
  const runtime = getSandboxRuntimeConfig();
  const user = encodeURIComponent(runtime.user);
  const password = encodeURIComponent(runtime.password);
  const host = params.containerRef ?? runtime.host;
  const port = params.containerRef ? 5432 : runtime.port;

  return `postgresql://${user}:${password}@${host}:${port}/${params.dbName}`;
}

async function buildEvaluationContext(
  challengeVersion: Pick<
    PublishedChallengeVersionRow,
    'validatorType' | 'validatorConfig' | 'referenceSolution'
  >,
  queryExecution: {
    sandboxInstanceId: string | null;
    sqlText: string;
  },
): Promise<AttemptEvaluationContext> {
  if (!queryExecution.sandboxInstanceId) {
    return {};
  }

  const sandbox = await sandboxesRepository.findById(queryExecution.sandboxInstanceId);

  if (!sandbox?.dbName) {
    throw new QueryExecutionFailedError('Sandbox is not ready for challenge evaluation');
  }

  const connectionString = buildSandboxConnectionString({
    dbName: sandbox.dbName,
    containerRef: sandbox.containerRef ?? null,
  });
  const runtime = getSandboxRuntimeConfig();
  const validatorConfig =
    challengeVersion.validatorConfig && typeof challengeVersion.validatorConfig === 'object'
      ? (challengeVersion.validatorConfig as Record<string, unknown>)
      : {};
  const context: AttemptEvaluationContext = {};

  if (
    challengeVersion.validatorType === 'result_set' &&
    typeof challengeVersion.referenceSolution === 'string' &&
    challengeVersion.referenceSolution.trim().length > 0
  ) {
    const referenceResult = await executeSql(connectionString, challengeVersion.referenceSolution, {
      timeoutMs: runtime.maxQueryTimeMs,
      maxRows: runtime.maxRowsPreview,
    });

    context.referenceResult = {
      columns: referenceResult.columns,
      rows: referenceResult.rows,
      rowCount: referenceResult.rowCount,
      truncated: referenceResult.truncated,
    };
  }

  if (
    validatorConfig.requiresIndexOptimization === true &&
    shouldExplainAnalyze(queryExecution.sqlText)
  ) {
    context.explainPlan = await getExplainPlan(connectionString, queryExecution.sqlText, 'explain_analyze');
  }

  return context;
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
  const evaluationContext = await buildEvaluationContext(challengeVersion, queryExecution);
  const evaluation = evaluateAttempt(
    challengeVersion,
    queryExecution,
    sessionExecutions,
    evaluationContext,
  );

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

export async function getGlobalLeaderboard(
  period: 'weekly' | 'monthly' | 'alltime' = 'alltime',
  limit = 50,
): Promise<GlobalLeaderboardEntry[]> {
  const attempts = await challengesRepository.listPassedAttemptsForGlobalLeaderboard(
    getGlobalLeaderboardSince(period),
  );
  return buildGlobalLeaderboard(attempts, limit);
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

export async function getEditableChallenge(
  id: string,
  userId: string,
  isAdmin: boolean,
): Promise<EditableChallengeDetail> {
  const detail = await challengesRepository.findEditableChallengeById(id);

  if (!detail) {
    throw new NotFoundError('Challenge draft not found');
  }

  if (detail.createdBy !== userId && !isAdmin) {
    throw new ForbiddenError('Access denied to this challenge draft');
  }

  return normalizeEditableChallengeDetail(detail);
}

export async function validateChallengeDraft(
  data: ValidateChallengeDraftBody,
): Promise<ChallengeDraftValidationResult> {
  return buildDraftValidation(data);
}

export async function createChallenge(
  data: CreateChallengeBody,
  userId: string,
): Promise<CreateChallengeResult> {
  const validation = await buildDraftValidation(data);
  if (!validation.valid) {
    throw new ValidationError(validation.errors.join(' '));
  }
  const normalized = normalizeChallengeDraftPayload(data);

  const challenge = await challengesRepository.createChallenge({
    lessonId: normalized.lessonId,
    slug: normalized.slug,
    title: normalized.title,
    description: normalized.description,
    difficulty: normalized.difficulty,
    sortOrder: normalized.sortOrder,
    points: normalized.points,
    status: 'draft',
    createdBy: userId,
  });

  const version = await challengesRepository.createVersion({
    challengeId: challenge.id,
    versionNo: 1,
    problemStatement: normalized.problemStatement,
    hintText: normalized.hintText,
    expectedResultColumns: normalized.expectedResultColumns as unknown as Record<string, unknown>,
    referenceSolution: normalized.referenceSolution,
    validatorType: normalized.validatorType,
    validatorConfig: normalized.validatorConfig as unknown as Record<string, unknown>,
    createdBy: userId,
  });

  return { challenge, version };
}

export async function createChallengeVersion(
  challengeId: string,
  data: CreateChallengeVersionBody,
  userId: string,
  isAdmin: boolean,
): Promise<CreateChallengeResult> {
  const existing = await challengesRepository.findById(challengeId);

  if (!existing) {
    throw new NotFoundError('Challenge not found');
  }

  if (existing.createdBy !== userId && !isAdmin) {
    throw new ForbiddenError('Access denied to this challenge draft');
  }

  if (existing.status !== 'draft') {
    throw new ValidationError('Only draft challenges can be revised from the submission flow.');
  }

  const validation = await buildDraftValidation({ ...data, challengeId });
  if (!validation.valid) {
    throw new ValidationError(validation.errors.join(' '));
  }
  const normalized = normalizeChallengeDraftPayload(data);

  const challenge =
    (await challengesRepository.updateChallenge(challengeId, {
      lessonId: normalized.lessonId,
      slug: normalized.slug,
      title: normalized.title,
      description: normalized.description,
      difficulty: normalized.difficulty,
      sortOrder: normalized.sortOrder,
      points: normalized.points,
    })) ?? existing;

  const latestVersionNo = await challengesRepository.getLatestVersionNo(challengeId);
  const version = await challengesRepository.createVersion({
    challengeId,
    versionNo: latestVersionNo + 1,
    problemStatement: normalized.problemStatement,
    hintText: normalized.hintText,
    expectedResultColumns: normalized.expectedResultColumns as unknown as Record<string, unknown>,
    referenceSolution: normalized.referenceSolution,
    validatorType: normalized.validatorType,
    validatorConfig: normalized.validatorConfig as unknown as Record<string, unknown>,
    createdBy: userId,
  });

  return { challenge, version };
}

export async function publishChallengeVersion(
  versionId: string,
  reviewerId?: string,
  reviewNote?: string,
): Promise<ChallengeVersionRow> {
  const version = await challengesRepository.findVersionById(versionId);

  if (!version) {
    throw new NotFoundError('Challenge version not found');
  }

  const published = await challengesRepository.publishVersion(versionId, version.challengeId, {
    reviewedBy: reviewerId,
    reviewNotes: normalizeNullableText(reviewNote),
  });

  if (!published) {
    throw new NotFoundError('Challenge version not found');
  }

  return published;
}

export async function reviewChallengeVersion(
  versionId: string,
  decision: ReviewChallengeVersionBody['decision'],
  reviewerId: string,
  reviewNote?: string,
): Promise<ChallengeVersionRow> {
  if (decision === 'approve') {
    return publishChallengeVersion(versionId, reviewerId, reviewNote);
  }

  const version = await challengesRepository.findVersionById(versionId);
  if (!version) {
    throw new NotFoundError('Challenge version not found');
  }

  if (version.isPublished) {
    throw new ValidationError('Published challenge versions cannot be rejected.');
  }

  const reviewed = await challengesRepository.reviewVersion(
    versionId,
    decision === 'reject' ? 'rejected' : 'changes_requested',
    normalizeNullableText(reviewNote),
    reviewerId,
  );

  if (!reviewed) {
    throw new NotFoundError('Challenge version not found');
  }

  return reviewed;
}
