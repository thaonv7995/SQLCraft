import { eq } from 'drizzle-orm';
import { getDb, schema as dbSchema } from '../../db';
import {
  challengesRepository,
  sandboxesRepository,
  sessionsRepository,
} from '../../db/repositories';
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
import {
  inferDatabaseDomain,
  type DatabaseDomain,
} from '../../lib/infer-database-domain';
import { resolvePublicAvatarUrl } from '../../lib/storage';
import type { ExplainResult } from '../../services/query-executor';
import { executeSql, getExplainPlan, validateSql } from '../../services/query-executor';
import { getSessionSchemaDiff, type SessionSchemaDiffResult } from '../sessions/sessions.service';
import type {
  CreateChallengeBody,
  CreateChallengeVersionBody,
  ListAdminChallengesCatalogQuery,
  ReviewChallengeVersionBody,
  SubmitAttemptBody,
  ValidateChallengeDraftBody,
} from './challenges.schema';

async function withPresignedLeaderboardAvatars<T extends { avatarUrl: string | null }>(
  entries: T[],
): Promise<T[]> {
  return Promise.all(
    entries.map(async (entry) => ({
      ...entry,
      avatarUrl: await resolvePublicAvatarUrl(entry.avatarUrl),
    })),
  );
}

export interface AttemptEvaluation {
  isCorrect: boolean;
  passesChallenge: boolean;
  score: number;
  feedbackText: string;
  pointsPossible: number;
  baselineDurationMs: number | null;
  latestDurationMs: number | null;
  meetsPerformanceTarget?: boolean | null;
  requiresIndexOptimization?: boolean;
  usedIndexing: boolean;
  queryTotalCost?: number | null;
  queryActualTime?: number | null;
  schemaDiff?: SessionSchemaDiffResult | null;
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
  databaseId?: string | null;
  databaseName?: string | null;
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
    totalCost: number | null;
  };
}

export interface ChallengeLeaderboardEntry {
  rank: number;
  attemptId: string;
  queryExecutionId: string;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bestDurationMs: number | null;
  bestTotalCost: number | null;
  sqlText: string;
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
  databaseId?: string | null;
  databaseName?: string | null;
  databaseSlug?: string | null;
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

export interface AdminChallengeCatalogItem extends ChallengeReviewItem {
  catalogDomain: DatabaseDomain;
}

export interface EditableChallengeDetail {
  id: string;
  databaseId?: string | null;
  databaseName?: string | null;
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

const QUERY_EXECUTION_ATTEMPT_UNIQUE_CONSTRAINT = 'challenge_attempts_query_execution_uidx';
const SESSION_CHALLENGE_ATTEMPT_NO_UNIQUE_CONSTRAINT =
  'challenge_attempts_session_version_attempt_no_uidx';

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

function normalizeAttemptEvaluation(value: unknown): AttemptEvaluation | null {
  return value && typeof value === 'object' ? (value as AttemptEvaluation) : null;
}

function normalizeNullableMetric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compareNullableAscending(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function mapAttemptRow(row: ChallengeAttemptWithExecutionRow): ChallengeAttemptListItem {
  const evaluation = normalizeAttemptEvaluation(row.evaluation);

  return {
    id: row.id,
    learningSessionId: row.learningSessionId,
    challengeVersionId: row.challengeVersionId,
    queryExecutionId: row.queryExecutionId,
    attemptNo: row.attemptNo,
    status: row.status,
    score: row.score,
    evaluation,
    submittedAt: row.submittedAt,
    queryExecution: {
      sqlText: row.sqlText,
      status: row.queryStatus,
      rowsReturned: row.rowsReturned,
      durationMs: row.durationMs,
      totalCost: evaluation?.queryTotalCost ?? null,
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
    databaseId: row.databaseId ?? null,
    databaseName: row.databaseName ?? null,
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
  databaseId: string;
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
    | 'databaseId'
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
    databaseId: data.databaseId,
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

  const databaseExists = await sessionsRepository.findSchemaTemplateById(normalized.databaseId);
  if (!databaseExists) {
    errors.push('Database not found.');
  }

  const existingChallenge = await challengesRepository.findByDatabaseAndSlug(
    normalized.databaseId,
    normalized.slug,
  );
  if (existingChallenge && existingChallenge.id !== data.challengeId) {
    errors.push('Slug already exists for this database.');
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

export interface ChallengeLeaderboardContext {
  entries: ChallengeLeaderboardEntry[];
  totalRankedUsers: number;
  viewerRank: number | null;
  viewerEntry: ChallengeLeaderboardEntry | null;
}

function buildChallengeLeaderboardEntries(
  rows: ChallengeLeaderboardAttemptRow[],
): ChallengeLeaderboardEntry[] {
  const byUser = new Map<
    string,
    {
      attemptId: string | null;
      queryExecutionId: string | null;
      userId: string;
      username: string;
      displayName: string;
      avatarUrl: string | null;
      bestDurationMs: number | null;
      bestTotalCost: number | null;
      sqlText: string | null;
      attemptsCount: number;
      passedAttempts: number;
      lastSubmittedAt: Date;
      bestSubmittedAt: Date | null;
    }
  >();

  for (const row of rows) {
    const displayName = row.displayName ?? row.username;
    const evaluation = normalizeAttemptEvaluation(row.evaluation);
    const durationMs = row.durationMs;
    const totalCost = normalizeNullableMetric(evaluation?.queryTotalCost);
    const existing = byUser.get(row.userId);

    if (!existing) {
      const entry = {
        attemptId: row.status === 'passed' ? row.attemptId : null,
        queryExecutionId: row.status === 'passed' ? row.queryExecutionId : null,
        userId: row.userId,
        username: row.username,
        displayName,
        avatarUrl: row.avatarUrl,
        bestDurationMs: row.status === 'passed' ? durationMs : null,
        bestTotalCost: row.status === 'passed' ? totalCost : null,
        sqlText: row.status === 'passed' ? row.sqlText : null,
        attemptsCount: 1,
        passedAttempts: row.status === 'passed' ? 1 : 0,
        lastSubmittedAt: row.submittedAt,
        bestSubmittedAt: row.status === 'passed' ? row.submittedAt : null,
      };

      byUser.set(row.userId, entry);
      continue;
    }

    existing.attemptsCount += 1;
    existing.lastSubmittedAt =
      existing.lastSubmittedAt > row.submittedAt ? existing.lastSubmittedAt : row.submittedAt;
    if (row.status === 'passed') {
      existing.passedAttempts += 1;
    }

    if (row.status !== 'passed') {
      continue;
    }

    if (existing.attemptId === null || existing.bestSubmittedAt === null) {
      existing.attemptId = row.attemptId;
      existing.queryExecutionId = row.queryExecutionId;
      existing.bestDurationMs = durationMs;
      existing.bestTotalCost = totalCost;
      existing.sqlText = row.sqlText;
      existing.bestSubmittedAt = row.submittedAt;
      continue;
    }

    const durationComparison = compareNullableAscending(durationMs, existing.bestDurationMs);
    const costComparison = compareNullableAscending(totalCost, existing.bestTotalCost);
    if (
      durationComparison < 0 ||
      (durationComparison === 0 && costComparison < 0) ||
      (durationComparison === 0 &&
        costComparison === 0 &&
        row.submittedAt < existing.bestSubmittedAt)
    ) {
      existing.attemptId = row.attemptId;
      existing.queryExecutionId = row.queryExecutionId;
      existing.bestDurationMs = durationMs;
      existing.bestTotalCost = totalCost;
      existing.sqlText = row.sqlText;
      existing.bestSubmittedAt = row.submittedAt;
    }
  }

  return Array.from(byUser.values())
    .filter(
      (
        entry,
      ): entry is {
        attemptId: string;
        queryExecutionId: string;
        userId: string;
        username: string;
        displayName: string;
        avatarUrl: string | null;
        bestDurationMs: number | null;
        bestTotalCost: number | null;
        sqlText: string;
        attemptsCount: number;
        passedAttempts: number;
        lastSubmittedAt: Date;
        bestSubmittedAt: Date;
      } => entry.attemptId !== null && entry.queryExecutionId !== null && entry.sqlText !== null && entry.bestSubmittedAt !== null,
    )
    .sort((a, b) => {
      const durationComparison = compareNullableAscending(a.bestDurationMs, b.bestDurationMs);
      if (durationComparison !== 0) return durationComparison;

      const costComparison = compareNullableAscending(a.bestTotalCost, b.bestTotalCost);
      if (costComparison !== 0) return costComparison;

      return a.bestSubmittedAt.getTime() - b.bestSubmittedAt.getTime();
    })
    .map((entry, index) => ({
      rank: index + 1,
      attemptId: entry.attemptId,
      queryExecutionId: entry.queryExecutionId,
      userId: entry.userId,
      username: entry.username,
      displayName: entry.displayName,
      avatarUrl: entry.avatarUrl,
      bestDurationMs: entry.bestDurationMs,
      bestTotalCost: entry.bestTotalCost,
      sqlText: entry.sqlText,
      attemptsCount: entry.attemptsCount,
      passedAttempts: entry.passedAttempts,
      lastSubmittedAt: entry.lastSubmittedAt,
    }));
}

function buildLeaderboard(
  rows: ChallengeLeaderboardAttemptRow[],
  limit: number,
): ChallengeLeaderboardEntry[] {
  return buildChallengeLeaderboardEntries(rows).slice(0, limit);
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

function buildFeedback(evaluation: AttemptEvaluation): string {
  if (!evaluation.isCorrect) {
    return evaluation.feedbackText;
  }

  const notes: string[] = [
    evaluation.passesChallenge ? 'Challenge passed.' : 'Challenge requirements not met.',
    'Result set matches the validator.',
  ];

  if (evaluation.baselineDurationMs !== null) {
    if (evaluation.meetsPerformanceTarget === true) {
      notes.push(
        `Runtime target met: ${evaluation.latestDurationMs ?? 'unknown'} ms against the ${evaluation.baselineDurationMs} ms limit.`,
      );
    } else if (evaluation.latestDurationMs === null) {
      notes.push(`Runtime target could not be verified against the ${evaluation.baselineDurationMs} ms limit.`);
    } else {
      notes.push(
        `Runtime target missed: ${evaluation.latestDurationMs} ms is above the ${evaluation.baselineDurationMs} ms limit.`,
      );
    }
  }

  if (evaluation.requiresIndexOptimization) {
    notes.push(
      evaluation.usedIndexing
        ? 'Execution plan confirmed the required index usage.'
        : 'Execution plan did not confirm the required index usage.',
    );
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

  if (queryExecution.status !== 'succeeded') {
    return {
      isCorrect: false,
      passesChallenge: false,
      score: 0,
      feedbackText: `Query execution failed: ${queryExecution.errorMessage ?? 'Unknown error'}`,
      pointsPossible: totalPoints,
      baselineDurationMs,
      latestDurationMs: queryExecution.durationMs ?? null,
      meetsPerformanceTarget: baselineDurationMs === null ? null : false,
      requiresIndexOptimization,
      usedIndexing: false,
    };
  }

  const expectedColumns = normalizeExpectedResultColumns(challengeVersion.expectedResultColumns);
  const resultPreview = normalizeResultPreview(queryExecution.resultPreview);

  if (challengeVersion.validatorType === 'result_set') {
    if (resultPreview.columns.length === 0) {
      return {
        isCorrect: false,
        passesChallenge: false,
        score: 0,
        feedbackText: 'No results returned',
        pointsPossible: totalPoints,
        baselineDurationMs,
        latestDurationMs: queryExecution.durationMs ?? null,
        meetsPerformanceTarget: baselineDurationMs === null ? null : false,
        requiresIndexOptimization,
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
          passesChallenge: false,
          score: 0,
          feedbackText: comparison.feedbackText ?? 'Result set does not match the reference solution.',
          pointsPossible: totalPoints,
          baselineDurationMs,
          latestDurationMs: queryExecution.durationMs ?? null,
          meetsPerformanceTarget: baselineDurationMs === null ? null : false,
          requiresIndexOptimization,
          usedIndexing: false,
        };
      }
    } else if (expectedColumns.length > 0 && !compareColumnLists(resultPreview.columns, expectedColumns)) {
      return {
        isCorrect: false,
        passesChallenge: false,
        score: 0,
        feedbackText: `Expected columns: ${expectedColumns.join(', ')}. Got: ${resultPreview.columns.join(', ')}`,
        pointsPossible: totalPoints,
        baselineDurationMs,
        latestDurationMs: queryExecution.durationMs ?? null,
        meetsPerformanceTarget: baselineDurationMs === null ? null : false,
        requiresIndexOptimization,
        usedIndexing: false,
      };
    }
  }

  const latestDurationMs = queryExecution.durationMs ?? null;
  const meetsPerformanceTarget =
    baselineDurationMs === null ? null : latestDurationMs !== null && latestDurationMs <= baselineDurationMs;

  const usedIndexing =
    requiresIndexOptimization
      ? detectIndexUsage(sessionExecutions, queryExecution.id, context.explainPlan)
      : false;
  const passesChallenge =
    (baselineDurationMs === null || meetsPerformanceTarget === true) &&
    (!requiresIndexOptimization || usedIndexing);

  const evaluation: AttemptEvaluation = {
    isCorrect: true,
    passesChallenge,
    score: passesChallenge ? totalPoints : 0,
    feedbackText: '',
    pointsPossible: totalPoints,
    baselineDurationMs,
    latestDurationMs,
    meetsPerformanceTarget,
    requiresIndexOptimization,
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
    shouldExplainAnalyze(queryExecution.sqlText) &&
    (validatorConfig.requiresIndexOptimization === true || challengeVersion.validatorType === 'result_set')
  ) {
    try {
      context.explainPlan = await getExplainPlan(
        connectionString,
        queryExecution.sqlText,
        'explain_analyze',
      );
    } catch {
      context.explainPlan = null;
    }
  }

  return context;
}

function isUniqueConstraintViolation(error: unknown, constraintName: string): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const code = 'code' in error ? error.code : undefined;
  const constraint = 'constraint' in error ? error.constraint : undefined;

  return code === '23505' && constraint === constraintName;
}

async function createAttemptWithRetry(params: {
  learningSessionId: string;
  challengeVersionId: string;
  queryExecutionId: string;
  status: 'passed' | 'failed';
  score: number;
  evaluation: AttemptEvaluation;
}): Promise<ChallengeAttemptRow> {
  let attemptNo =
    (await challengesRepository.countAttempts(
      params.learningSessionId,
      params.challengeVersionId,
    )) + 1;

  for (let retry = 0; retry < 3; retry += 1) {
    try {
      return await challengesRepository.createAttempt({
        learningSessionId: params.learningSessionId,
        challengeVersionId: params.challengeVersionId,
        queryExecutionId: params.queryExecutionId,
        attemptNo,
        status: params.status,
        score: params.score,
        evaluation: params.evaluation as unknown as Record<string, unknown>,
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error, QUERY_EXECUTION_ATTEMPT_UNIQUE_CONSTRAINT)) {
        throw new ValidationError('This query execution has already been submitted');
      }

      if (isUniqueConstraintViolation(error, SESSION_CHALLENGE_ATTEMPT_NO_UNIQUE_CONSTRAINT)) {
        attemptNo =
          (await challengesRepository.countAttempts(
            params.learningSessionId,
            params.challengeVersionId,
          )) + 1;
        continue;
      }

      throw error;
    }
  }

  throw new ValidationError('Could not record the challenge attempt safely. Please retry.');
}

async function buildChallengeAttemptSchemaDiffSnapshot(
  learningSessionId: string,
  userId: string,
): Promise<SessionSchemaDiffResult | null> {
  try {
    return await getSessionSchemaDiff(learningSessionId, userId, false);
  } catch {
    return null;
  }
}

export async function submitAttempt(
  data: SubmitAttemptBody,
  userId: string,
): Promise<AttemptResult> {
  const session = await challengesRepository.findSessionSubmissionContext(data.learningSessionId);

  if (!session) {
    throw new NotFoundError('Learning session not found');
  }

  if (session.userId !== userId) {
    throw new ForbiddenError('Access denied to this session');
  }

  if (!session.challengeVersionId) {
    throw new ValidationError('This session is not attached to a challenge');
  }

  if (data.challengeVersionId && data.challengeVersionId !== session.challengeVersionId) {
    throw new ValidationError('Submitted challenge version does not match the session challenge');
  }

  const challengeVersionId = session.challengeVersionId;
  const challengeVersion = await challengesRepository.findPublishedVersionById(challengeVersionId);

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

  const existingAttempt = await challengesRepository.findAttemptByQueryExecutionId(data.queryExecutionId);

  if (existingAttempt) {
    throw new ValidationError('This query execution has already been submitted');
  }

  const sessionExecutions = await challengesRepository.listSessionExecutions(
    data.learningSessionId,
    userId,
  );
  const evaluationContext = await buildEvaluationContext(challengeVersion, queryExecution);
  const baseEvaluation = evaluateAttempt(
    challengeVersion,
    queryExecution,
    sessionExecutions,
    evaluationContext,
  );
  const schemaDiff = await buildChallengeAttemptSchemaDiffSnapshot(data.learningSessionId, userId);
  const evaluation: AttemptEvaluation = {
    ...baseEvaluation,
    queryTotalCost: normalizeNullableMetric(evaluationContext.explainPlan?.planSummary?.totalCost),
    queryActualTime: normalizeNullableMetric(evaluationContext.explainPlan?.planSummary?.actualTime),
    schemaDiff,
  };

  const attempt = await createAttemptWithRetry({
    learningSessionId: data.learningSessionId,
    challengeVersionId,
    queryExecutionId: data.queryExecutionId,
    status: evaluation.passesChallenge ? 'passed' : 'failed',
    score: evaluation.score,
    evaluation,
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
  const rows = buildLeaderboard(attempts, limit);
  return withPresignedLeaderboardAvatars(rows);
}

export async function getChallengeLeaderboardContext(
  challengeVersionId: string,
  limit = 25,
  viewerUserId?: string | null,
): Promise<ChallengeLeaderboardContext> {
  const detail = await challengesRepository.findPublishedVersionDetailById(challengeVersionId);

  if (!detail) {
    throw new NotFoundError('Challenge version not found or not published');
  }

  const attempts = await challengesRepository.listAttemptsForChallengeVersion(challengeVersionId);
  const all = buildChallengeLeaderboardEntries(attempts);
  const viewerEntryRaw =
    viewerUserId && viewerUserId.length > 0
      ? all.find((entry) => entry.userId === viewerUserId) ?? null
      : null;

  const top = all.slice(0, limit);
  const [entries, viewerEntry] = await Promise.all([
    withPresignedLeaderboardAvatars(top),
    viewerEntryRaw
      ? (async () => ({
          ...viewerEntryRaw,
          avatarUrl: await resolvePublicAvatarUrl(viewerEntryRaw.avatarUrl),
        }))()
      : Promise.resolve(null),
  ]);

  return {
    entries,
    totalRankedUsers: all.length,
    viewerRank: viewerEntry?.rank ?? null,
    viewerEntry,
  };
}

export async function getGlobalLeaderboard(
  period: 'weekly' | 'monthly' | 'alltime' = 'alltime',
  limit = 50,
): Promise<GlobalLeaderboardEntry[]> {
  const attempts = await challengesRepository.listPassedAttemptsForGlobalLeaderboard(
    getGlobalLeaderboardSince(period),
  );
  const rows = buildGlobalLeaderboard(attempts, limit);
  return withPresignedLeaderboardAvatars(rows);
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

export async function listAdminChallengesCatalog(query: ListAdminChallengesCatalogQuery): Promise<{
  items: AdminChallengeCatalogItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const db = getDb();
  let databaseIdsIn: string[] | undefined;

  if (query.domain) {
    const templates = await db
      .select({
        id: dbSchema.schemaTemplates.id,
        name: dbSchema.schemaTemplates.name,
        description: dbSchema.schemaTemplates.description,
      })
      .from(dbSchema.schemaTemplates)
      .where(eq(dbSchema.schemaTemplates.status, 'published'));

    const inDomain = templates
      .filter((t) => inferDatabaseDomain(t.name, t.description) === query.domain)
      .map((t) => t.id);

    if (query.databaseId) {
      if (!inDomain.includes(query.databaseId)) {
        return {
          items: [],
          total: 0,
          page: query.page,
          limit: query.limit,
          totalPages: 1,
        };
      }
      databaseIdsIn = [query.databaseId];
    } else {
      databaseIdsIn = inDomain;
      if (databaseIdsIn.length === 0) {
        return {
          items: [],
          total: 0,
          page: query.page,
          limit: query.limit,
          totalPages: 1,
        };
      }
    }
  } else if (query.databaseId) {
    databaseIdsIn = [query.databaseId];
  }

  const statusFilter =
    query.status === 'all' ? undefined : (query.status as 'draft' | 'published' | 'archived');

  const offset = (query.page - 1) * query.limit;
  const { items: rows, total } = await challengesRepository.listChallengesAdmin({
    limit: query.limit,
    offset,
    databaseIdsIn,
    status: statusFilter,
  });

  const items = rows.map((row) => ({
    ...normalizeReviewRow(row),
    catalogDomain: inferDatabaseDomain(row.databaseName ?? '', ''),
  }));
  const totalPages = Math.max(1, Math.ceil(total / query.limit));

  return {
    items,
    total,
    page: query.page,
    limit: query.limit,
    totalPages,
  };
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
    databaseId: normalized.databaseId,
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
      databaseId: normalized.databaseId ?? undefined,
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
