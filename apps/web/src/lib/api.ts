import type { SchemaSqlDialect } from '@sqlcraft/types';
import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { SQL_DUMP_DIRECT_UPLOAD_MIN_BYTES } from './sql-dump-limits';
import { getExplainPlanMode } from './utils';

export type { SchemaSqlDialect } from '@sqlcraft/types';

declare module 'axios' {
  // Preserve Axios generics while extending request config with a local flag.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface AxiosRequestConfig<D = any> {
    skipAuthRedirect?: boolean;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  interface InternalAxiosRequestConfig<D = any> {
    skipAuthRedirect?: boolean;
  }
}

type ApiInternalRequestConfig<D = unknown> = InternalAxiosRequestConfig<D>;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  code: string;
  message: string;
  data: T;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  username: string;
  email: string;
  password: string;
  displayName?: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export type UserRole = 'user' | 'admin';

interface UserPayload {
  id: string;
  username: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  role?: string;
  roles?: string[];
  status?: string;
  bio?: string | null;
  createdAt: string;
  lastLoginAt?: string | null;
  updatedAt?: string;
  stats?: UserStats;
}

export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
  role: UserRole;
  roles?: string[];
  status?: string;
  bio?: string | null;
  createdAt: string;
  lastLoginAt?: string | null;
  updatedAt?: string;
  stats?: UserStats;
}

export interface UserStats {
  activeSessions: number;
  completedChallenges: number;
  /** Count of query executions in the last 7 days (rolling window). */
  queriesRun: number;
  currentStreak: number;
  totalPoints: number;
}

// ─── Tracks & Lessons ─────────────────────────────────────────────────────────

export interface Track {
  id: string;
  title: string;
  slug: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  lessonCount: number;
  coverUrl?: string | null;
  status?: 'draft' | 'published' | 'archived';
  sortOrder?: number;
  createdAt?: string;
  updatedAt?: string;
  estimatedHours?: number;
  tags?: string[];
  thumbnailUrl?: string;
  isPublished?: boolean;
  userProgress?: {
    completedLessons: number;
    lastAccessedAt: string;
  };
}

export interface Lesson {
  id: string;
  trackId: string;
  title: string;
  slug: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedMinutes: number;
  sortOrder: number;
  /** The currently published lesson version ID — pass this to create a session */
  publishedVersionId?: string | null;
  status?: 'draft' | 'published' | 'archived';
  createdAt?: string;
  updatedAt?: string;
}

export interface LessonChallengeSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  sortOrder: number;
  points?: number;
  publishedVersionId?: string | null;
}

export interface LessonVersionOutline {
  id: string;
  trackId: string;
  slug: string;
  title: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedMinutes: number;
}

export interface SchemaTemplateSummary {
  id: string;
  name: string;
  description?: string | null;
  version: number;
  definition: unknown;
  status: 'draft' | 'published' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface LessonVersion {
  id: string;
  lessonId: string;
  versionNo: number;
  title: string;
  content: string;
  starterQuery?: string | null;
  isPublished: boolean;
  schemaTemplateId?: string | null;
  datasetTemplateId?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  lesson: LessonVersionOutline | null;
  challenges: LessonChallengeSummary[];
  schemaTemplate: SchemaTemplateSummary | null;
}

export interface ChallengeVersionDetail {
  id: string;
  challengeId: string;
  visibility?: 'public' | 'private';
  databaseId?: string;
  databaseName?: string;
  lessonId: string;
  slug: string;
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  sortOrder: number;
  points: number;
  problemStatement: string;
  hintText: string | null;
  expectedResultColumns: string[];
  validatorType: string;
  validatorConfig?: Record<string, unknown> | null;
  publishedAt?: string | null;
  createdAt: string;
}

export interface PassCriterionCheckClient {
  type: string;
  passed: boolean;
  detail: string;
}

export interface ChallengeEvaluation {
  isCorrect: boolean;
  passesChallenge?: boolean;
  score?: number;
  feedbackText?: string;
  pointsPossible?: number;
  baselineDurationMs?: number | null;
  latestDurationMs?: number | null;
  meetsPerformanceTarget?: boolean | null;
  maxTotalCost?: number | null;
  meetsCostTarget?: boolean | null;
  requiresIndexOptimization?: boolean;
  usedIndexing?: boolean;
  queryTotalCost?: number | null;
  queryActualTime?: number | null;
  schemaDiff?: Record<string, unknown> | null;
  passCriterionChecks?: PassCriterionCheckClient[];
}

export interface ChallengeAttempt {
  id: string;
  learningSessionId: string;
  challengeVersionId: string;
  queryExecutionId: string;
  attemptNo: number;
  status: 'pending' | 'passed' | 'failed' | 'error';
  score: number | null;
  evaluation: ChallengeEvaluation | null;
  submittedAt: string;
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
  avatarUrl?: string | null;
  bestDurationMs: number | null;
  bestTotalCost: number | null;
  sqlText: string;
  attemptsCount: number;
  passedAttempts: number;
  lastSubmittedAt: string;
}

const DATASET_SCALE_ORDER = ['tiny', 'small', 'medium', 'large'] as const;
export type DatasetScale = (typeof DATASET_SCALE_ORDER)[number];
const DATASET_SCALE_RANK = Object.fromEntries(
  DATASET_SCALE_ORDER.map((scale, index) => [scale, index]),
) as Record<DatasetScale, number>;

/** Top-N entries plus the signed-in user's true rank (may be outside the top N). */
export interface ChallengeLeaderboardContext {
  entries: ChallengeLeaderboardEntry[];
  totalRankedUsers: number;
  viewerRank: number | null;
  viewerEntry: ChallengeLeaderboardEntry | null;
}

export interface ChallengeCatalogItem {
  id: string;
  databaseId?: string;
  databaseName?: string;
  databaseSlug?: string;
  lessonId: string;
  lessonSlug: string;
  lessonTitle: string;
  trackId: string;
  trackSlug: string;
  trackTitle: string;
  slug: string;
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  sortOrder: number;
  visibility?: 'public' | 'private';
  status: 'draft' | 'published' | 'archived';
  points: number;
  datasetScale: DatasetScale;
  publishedVersionId?: string | null;
  latestVersionId?: string | null;
  latestVersionNo?: number | null;
  validatorType?: string | null;
  latestVersionReviewStatus?: 'pending' | 'approved' | 'changes_requested' | 'rejected' | null;
  latestVersionReviewNotes?: string | null;
  latestVersionReviewedAt?: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface ChallengeReviewItem extends ChallengeCatalogItem {
  createdBy: {
    id?: string | null;
    username?: string | null;
    displayName?: string | null;
  };
}

export interface EditableChallengeDetail {
  id: string;
  databaseId?: string;
  databaseName?: string;
  lessonId: string;
  visibility?: 'public' | 'private';
  invitedUserIds?: string[];
  slug: string;
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  sortOrder: number;
  points: number;
  datasetScale: DatasetScale;
  status: 'draft' | 'published' | 'archived';
  publishedVersionId?: string | null;
  updatedAt: string;
  createdAt: string;
  latestVersion: {
    id: string;
    versionNo: number;
    problemStatement: string;
    hintText?: string | null;
    expectedResultColumns: string[];
    referenceSolution?: string | null;
    validatorType: string;
    validatorConfig?: Record<string, unknown> | null;
    isPublished: boolean;
    reviewStatus: 'pending' | 'approved' | 'changes_requested' | 'rejected';
    reviewNotes?: string | null;
    reviewedBy?: string | null;
    reviewedAt?: string | null;
    publishedAt?: string | null;
    createdAt: string;
  };
}

export interface ChallengeDraftValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalized: {
    slug: string;
    expectedResultColumns: string[];
    referenceSolution?: string | null;
    validatorConfig?: Record<string, unknown> | null;
  };
}

export interface LessonVersionSummary {
  id: string;
  lessonId: string;
  versionNo: number;
  title: string;
  isPublished: boolean;
  schemaTemplateId?: string | null;
  datasetTemplateId?: string | null;
  publishedAt?: string | null;
  createdAt: string;
}

export interface AdminLessonVersionDetail {
  id: string;
  lessonId: string;
  versionNo: number;
  title: string;
  content: string;
  starterQuery?: string | null;
  isPublished: boolean;
  schemaTemplateId?: string | null;
  datasetTemplateId?: string | null;
  publishedAt?: string | null;
  createdBy?: string | null;
  createdAt: string;
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export interface DatasetScaleContext {
  sourceScale: DatasetScale | null;
  selectedScale: DatasetScale | null;
  availableScales: DatasetScale[];
  rowCount?: number;
  sourceRowCount?: number;
}

interface NestedDatasetScalePayload {
  sourceScale?: unknown;
  selectedScale?: unknown;
  availableScales?: unknown;
  totalRows?: unknown;
  sourceTotalRows?: unknown;
}

function normalizeDatasetScale(value: unknown): DatasetScale | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.toLowerCase();
  if (normalized === 'massive') {
    return 'large';
  }

  if (DATASET_SCALE_ORDER.includes(normalized as DatasetScale)) {
    return normalized as DatasetScale;
  }

  return null;
}

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function normalizeAvailableDatasetScales(
  input: unknown,
  sourceScale?: DatasetScale | null,
): DatasetScale[] {
  const sourceRank =
    sourceScale != null ? DATASET_SCALE_RANK[sourceScale] : Number.POSITIVE_INFINITY;

  const candidates = Array.isArray(input) ? input : [];
  const normalized = Array.from(
    new Set(
      candidates
        .map((candidate) => normalizeDatasetScale(candidate))
        .filter((scale): scale is DatasetScale => scale != null)
        .filter((scale) => DATASET_SCALE_RANK[scale] <= sourceRank),
    ),
  ).sort((a, b) => DATASET_SCALE_RANK[a] - DATASET_SCALE_RANK[b]);

  if (normalized.length > 0) {
    return normalized;
  }

  if (sourceScale != null) {
    return DATASET_SCALE_ORDER.filter((scale) => DATASET_SCALE_RANK[scale] <= sourceRank);
  }

  return [...DATASET_SCALE_ORDER];
}

export function resolveDatasetScaleContext(payload: {
  sourceScale?: unknown;
  selectedScale?: unknown;
  availableScales?: unknown;
  scale?: unknown;
  rowCount?: unknown;
  sourceRowCount?: unknown;
  dataset?: unknown;
}): DatasetScaleContext {
  const nestedDataset =
    payload.dataset && typeof payload.dataset === 'object'
      ? (payload.dataset as NestedDatasetScalePayload)
      : null;
  const sourceScale =
    normalizeDatasetScale(payload.sourceScale) ??
    normalizeDatasetScale(payload.scale) ??
    normalizeDatasetScale(nestedDataset?.sourceScale);
  const availableScales = normalizeAvailableDatasetScales(
    payload.availableScales ?? nestedDataset?.availableScales,
    sourceScale,
  );

  const requestedSelectedScale =
    normalizeDatasetScale(payload.selectedScale) ??
    normalizeDatasetScale(payload.scale) ??
    normalizeDatasetScale(nestedDataset?.selectedScale);

  const selectedScale =
    requestedSelectedScale && availableScales.includes(requestedSelectedScale)
      ? requestedSelectedScale
      : sourceScale && availableScales.includes(sourceScale)
        ? sourceScale
        : (availableScales.at(-1) ?? null);

  const rowCount = toFiniteNumber(payload.rowCount) ?? toFiniteNumber(nestedDataset?.totalRows);
  const sourceRowCount =
    toFiniteNumber(payload.sourceRowCount) ??
    toFiniteNumber(nestedDataset?.sourceTotalRows) ??
    rowCount;

  return {
    sourceScale: sourceScale ?? null,
    selectedScale,
    availableScales,
    rowCount,
    sourceRowCount,
  };
}

export interface SessionProvisioningEstimate {
  estimatedSeconds: number;
  estimatedReadyAt: string;
}

export interface LearningSession {
  id: string;
  userId: string;
  lessonVersionId: string | null;
  challengeVersionId?: string | null;
  databaseName?: string | null;
  status: 'provisioning' | 'active' | 'paused' | 'ended' | 'expired' | 'failed';
  sandboxStatus?: string | null;
  lessonTitle?: string | null;
  displayTitle?: string;
  sandbox?: {
    id: string;
    status: string;
    dbName?: string | null;
    expiresAt?: string | null;
    updatedAt?: string | null;
  } | null;
  sourceScale?: DatasetScale | null;
  selectedScale?: DatasetScale | null;
  availableScales?: DatasetScale[];
  rowCount?: number;
  sourceRowCount?: number;
  provisioningEstimate?: SessionProvisioningEstimate | null;
  startedAt: string;
  lastActivityAt?: string | null;
  createdAt: string;
}

export interface LabSessionHeartbeatResponse {
  expiresAt: string | null;
  lastActivityAt: string;
}

// ─── Query Execution ──────────────────────────────────────────────────────────

export interface QueryExecutionRequest {
  sessionId: string;
  sql: string;
}

export interface QueryResultColumn {
  name: string;
  dataType: string;
  nullable: boolean;
}

export interface QueryResultPreview {
  columns: QueryResultColumn[];
  rows: Record<string, unknown>[];
  totalRows: number;
  truncated: boolean;
}

export interface QueryExecutionPlan {
  type: 'json' | 'text';
  plan: unknown;
  totalCost?: number;
  actualTime?: number;
  mode?: 'explain' | 'explain_analyze';
}

export interface QueryExecution {
  id: string;
  sessionId: string;
  sql: string;
  status: 'pending' | 'running' | 'success' | 'error';
  durationMs?: number;
  rowCount?: number;
  errorMessage?: string;
  result?: QueryResultPreview;
  executionPlan?: QueryExecutionPlan;
  createdAt: string;
}

function mapQueryExecutionStatus(raw: unknown): QueryExecution['status'] {
  if (raw == null) return 'pending';
  const s = String(raw).toLowerCase();
  if (s === 'succeeded' || s === 'success' || s === 'completed') return 'success';
  if (s === 'failed' || s === 'timed_out' || s === 'blocked' || s === 'error') return 'error';
  if (s === 'running') return 'running';
  if (s === 'pending') return 'pending';
  return 'pending';
}

function toNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeQueryResultPreview(
  preview: unknown,
): QueryExecution['result'] {
  const normalizedPreview =
    preview && typeof preview === 'object'
      ? (preview as Record<string, unknown>)
      : null;

  if (!normalizedPreview) {
    return undefined;
  }

  const columns = Array.isArray(normalizedPreview.columns) ? normalizedPreview.columns : [];
  const rows = Array.isArray(normalizedPreview.rows) ? normalizedPreview.rows : [];

  if (
    columns.every((column) => typeof column === 'object' && column !== null && 'name' in column) &&
    rows.every((row) => row != null && typeof row === 'object' && !Array.isArray(row))
  ) {
    return {
      columns: columns as QueryResultPreview['columns'],
      rows: rows as QueryResultPreview['rows'],
      totalRows: toNumber(normalizedPreview.totalRows) ?? rows.length,
      truncated: Boolean(normalizedPreview.truncated),
    };
  }

  return undefined;
}

function normalizeExecutionPlanFromPayload(
  executionPlan: unknown,
): QueryExecution['executionPlan'] {
  const directPlan =
    executionPlan && typeof executionPlan === 'object'
      ? (executionPlan as Record<string, unknown>)
      : null;

  if (directPlan && 'plan' in directPlan) {
    return {
      type: directPlan.type === 'text' ? 'text' : 'json',
      plan: directPlan.plan,
      totalCost: toNumber(directPlan.totalCost),
      actualTime: toNumber(directPlan.actualTime),
      mode:
        directPlan.mode === 'explain' || directPlan.mode === 'explain_analyze'
          ? directPlan.mode
          : undefined,
    };
  }

  return undefined;
}

/** Normalize API rows that may use sqlText / learningSessionId / submittedAt. */
export function normalizeQueryExecutionItem(item: Record<string, unknown>): QueryExecution {
  const sql =
    (typeof item.sql === 'string' ? item.sql : null) ??
    (typeof item.sqlText === 'string' ? item.sqlText : '') ??
    '';
  const sessionId =
    (typeof item.sessionId === 'string' ? item.sessionId : null) ??
    (typeof item.learningSessionId === 'string' ? item.learningSessionId : '') ??
    '';
  const createdAt =
    (typeof item.createdAt === 'string' ? item.createdAt : null) ??
    (typeof item.submittedAt === 'string' ? item.submittedAt : new Date().toISOString());
  return {
    id: String(item.id ?? ''),
    sessionId,
    sql,
    status: mapQueryExecutionStatus(item.status),
    durationMs: typeof item.durationMs === 'number' ? item.durationMs : undefined,
    rowCount:
      typeof item.rowCount === 'number'
        ? item.rowCount
        : typeof item.rowsReturned === 'number'
          ? item.rowsReturned
          : undefined,
    errorMessage: typeof item.errorMessage === 'string' ? item.errorMessage : undefined,
    result: normalizeQueryResultPreview(item.result),
    executionPlan: normalizeExecutionPlanFromPayload(item.executionPlan),
    createdAt,
  };
}

function normalizeQueryHistoryPage(
  data: PaginatedResponse<QueryExecution>
): PaginatedResponse<QueryExecution> {
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    ...data,
    items: items.map((row) =>
      normalizeQueryExecutionItem(row as unknown as Record<string, unknown>)
    ),
  };
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export interface SystemMetrics {
  activeSandboxes: number;
  totalUsers: number;
  querySuccessRate: number;
  p95LatencyMs: number;
  totalQueriesLast24h: number;
  errorRate: number;
}

export interface SystemJob {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying';
  target?: string;
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
}

export interface AdminSystemHealth {
  status: 'healthy';
  timestamp: string;
  stats: {
    users: number;
    tracks: number;
    lessons: number;
    activeSessions: number;
    pendingJobs: number;
  };
}

export interface AdminAuditLogEntry {
  id: string;
  userId: string | null;
  actorUsername: string | null;
  actorEmail: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  payload: unknown;
  ipAddress: string | null;
  createdAt: string;
}

export interface AdminAuditLogsPage {
  items: AdminAuditLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ClearStaleSessionsResult {
  clearedCount: number;
  sessionIds: string[];
  thresholdMinutes: number;
}

export interface AdminConfig {
  platform: {
    defaultDialect: SchemaSqlDialect;
    defaultChallengePoints: string;
    sessionTimeoutMinutes: string;
    dailyQueryBudget: string;
    starterSchemaVisibility: 'schema-only' | 'schema-and-sample' | 'delayed-sample';
    enableExplainHints: boolean;
    allowSampleDataDownloads: boolean;
    operatorNote: string;
  };
  rankings: {
    globalWindow: 'all-time' | 'seasonal' | 'rolling-30';
    globalLeaderboardSize: string;
    challengeLeaderboardSize: string;
    tieBreaker: 'completion-speed' | 'accuracy-first' | 'recent-activity';
    refreshInterval: '1m' | '5m' | '15m';
    displayProvisionalRanks: boolean;
    highlightRecentMovers: boolean;
  };
  moderation: {
    requireDraftValidation: boolean;
    blockDangerousSql: boolean;
    autoHoldHighPointSubmissions: boolean;
    manualReviewSlaHours: string;
    publishChecklist: string;
    rejectionTemplate: string;
  };
  infrastructure: {
    queryWorkerConcurrency: string;
    evaluationWorkerConcurrency: string;
    sandboxWarmPool: string;
    runRetentionDays: string;
    objectStorageClass: 'standard' | 'infrequent' | 'archive';
    warningThresholdGb: string;
    keepExecutionSnapshots: boolean;
    enableNightlyExports: boolean;
  };
  flags: {
    globalRankings: boolean;
    challengeRankings: boolean;
    submissionQueue: boolean;
    explanationPanel: boolean;
    snapshotExports: boolean;
  };
  /** Limits for end-user SQL dump uploads (enforced server-side). */
  userDatabases: {
    maxPrivateDatabasesPerUser: string;
    maxPublicDatabasesPendingReviewPerUser: string;
  };
}

export interface AdminConfigRecord {
  id: string;
  scope: string;
  config: AdminConfig;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RawSystemJob {
  id: string;
  type: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'retrying';
  payload?: Record<string, unknown> | null;
  result?: Record<string, unknown> | null;
  errorMessage?: string | null;
  scheduledAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
}

// ─── Session Schema ───────────────────────────────────────────────────────────

export interface SessionSchemaColumn {
  name: string;
  type: string;
  isPrimary: boolean;
  isForeign: boolean;
  isNullable: boolean;
  references?: string;
}

export interface SessionSchemaTable {
  name: string;
  columns: SessionSchemaColumn[];
}

export interface SessionSchemaResponse {
  schemaTemplateId?: string;
  tables: SessionSchemaTable[];
}

export interface SessionSchemaIndex {
  name: string;
  tableName: string;
  definition: string;
}

export interface SessionSchemaView {
  name: string;
  definition: string;
}

export interface SessionSchemaFunction {
  name: string;
  signature: string;
  language?: string | null;
  definition: string;
}

export interface SessionSchemaPartition {
  name: string;
  parentTable: string;
  strategy?: string | null;
  definition?: string | null;
}

export interface SessionSchemaDiffSection<T> {
  base: T[];
  current: T[];
  added: T[];
  removed: T[];
  changed: Array<{
    base: T;
    current: T;
  }>;
}

export interface SessionSchemaDiffResponse {
  schemaTemplateId: string;
  hasChanges: boolean;
  indexes: SessionSchemaDiffSection<SessionSchemaIndex>;
  views: SessionSchemaDiffSection<SessionSchemaView>;
  materializedViews: SessionSchemaDiffSection<SessionSchemaView>;
  functions: SessionSchemaDiffSection<SessionSchemaFunction>;
  partitions: SessionSchemaDiffSection<SessionSchemaPartition>;
}

export type SessionSchemaRevertResourceType =
  | 'indexes'
  | 'views'
  | 'materializedViews'
  | 'functions'
  | 'partitions';
export type SessionSchemaRevertChangeType = 'added' | 'removed' | 'changed';

export interface RevertSessionSchemaChangePayload {
  resourceType: SessionSchemaRevertResourceType;
  changeType: SessionSchemaRevertChangeType;
  name: string;
  tableName?: string;
  signature?: string;
}

// ─── Databases ────────────────────────────────────────────────────────────────

export type DatabaseDomain = 'ecommerce' | 'fintech' | 'health' | 'iot' | 'social' | 'analytics' | 'other';
export type DatabaseScale = 'tiny' | 'small' | 'medium' | 'large';
export type DatabaseDifficulty = 'beginner' | 'intermediate' | 'advanced';

export interface Database {
  id: string;
  name: string;
  slug: string;
  description: string;
  domain: DatabaseDomain;
  scale: DatabaseScale;
  difficulty: DatabaseDifficulty;
  dialect?: SchemaSqlDialect;
  /** From schema template; used when locking metadata on “upload new version”. */
  engineVersion?: string | null;
  engine: string;
  domainIcon: string;
  tags: string[];
  rowCount: number;
  sourceRowCount?: number;
  tableCount: number;
  estimatedSizeGb: number;
  schemaTemplateId?: string;
  sourceScale?: DatasetScale | null;
  selectedScale?: DatasetScale | null;
  availableScales?: DatasetScale[];
  availableScaleMetadata?: Array<{ scale: DatasetScale; rowCount: number }>;
  region?: string;
  uptime?: number;
  isAvailable?: boolean;
  schema?: DatabaseTable[];
  relationships?: DatabaseRelationship[];
}

/** Admin paginated catalog (`GET /admin/challenges/catalog`). */
export interface AdminChallengeCatalogItem extends ChallengeReviewItem {
  catalogDomain: DatabaseDomain;
}

export interface AdminChallengesCatalogPage {
  items: AdminChallengeCatalogItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface DatabaseTable {
  name: string;
  role?: 'primary' | 'secondary' | 'junction';
  columns: DatabaseColumn[];
}

export interface DatabaseColumn {
  name: string;
  type: string;
  isPrimary?: boolean;
  isForeign?: boolean;
  isNullable?: boolean;
  references?: string;
}

export interface DatabaseRelationship {
  from: string;
  to: string;
  label?: string;
}

export interface SqlDumpColumnSummary {
  name: string;
  type: string;
  nullable: boolean;
  isPrimary?: boolean;
  isForeign?: boolean;
}

export interface SqlDumpTableSummary {
  name: string;
  rowCount: number;
  columnCount: number;
  columns: SqlDumpColumnSummary[];
}

export type SqlDialectConfidence = 'high' | 'medium' | 'low';

export type SqlDumpDirectUploadSessionCreateResult =
  | {
      mode: 'single';
      sessionId: string;
      stagingKey: string;
      putUrl: string;
      expiresAt: string;
      presignExpiresInSeconds: number;
    }
  | {
      mode: 'multipart';
      sessionId: string;
      stagingKey: string;
      uploadId: string;
      partSize: number;
      totalParts: number;
      expiresAt: string;
      presignExpiresInSeconds: number;
    };

export interface SqlDumpUploadPresignPartResult {
  url: string;
  presignExpiresInSeconds: number;
}

export interface SqlDumpScanResult {
  scanId: string;
  fileName: string;
  databaseName?: string | null;
  schemaName?: string | null;
  domain: DatabaseDomain;
  inferredScale?: DatasetScale | null;
  inferredDialect: SchemaSqlDialect;
  dialectConfidence: SqlDialectConfidence;
  /** From dump header when present; used for sandbox Postgres image major. */
  inferredEngineVersion?: string | null;
  totalTables: number;
  totalRows: number;
  columnCount: number;
  detectedPrimaryKeys: number;
  detectedForeignKeys: number;
  tables: SqlDumpTableSummary[];
  /** Server stored the file without parsing CREATE TABLE (canonical SQL only). */
  artifactOnly?: boolean;
}

export interface SqlDumpImportPayload {
  scanId: string;
  schemaName: string;
  domain: DatabaseDomain;
  datasetScale?: DatasetScale | null;
  description?: string | null;
  tags?: string[];
  /** Overrides scan {@link SqlDumpScanResult.inferredDialect} when the heuristic was wrong. */
  dialect?: SchemaSqlDialect;
  /** Non-empty string overrides {@link SqlDumpScanResult.inferredEngineVersion}. Omit to use scan value. */
  engineVersion?: string | null;
  /** When set, publish as a new version of this catalog database (stable URL id unchanged). */
  replaceSchemaTemplateId?: string;
}

/** POST /v1/databases/import-from-scan — public awaits admin review; private publishes with optional invites. */
export interface UserSqlDumpImportPayload {
  scanId: string;
  schemaName: string;
  domain: DatabaseDomain;
  datasetScale?: DatasetScale | null;
  description?: string | null;
  tags?: string[];
  dialect?: SchemaSqlDialect;
  engineVersion?: string | null;
  visibility?: 'public' | 'private';
  invitedUserIds?: string[];
}

export interface PendingSchemaTemplateReviewItem {
  id: string;
  catalogAnchorId: string;
  name: string;
  description: string | null;
  dialect: string;
  createdBy: string | null;
  createdAt: string;
}

export interface SqlDumpImportResult {
  schemaTemplateId: string;
  datasetTemplateId?: string | null;
  databaseId?: string;
}

export interface PendingSqlDumpScanItem {
  scanId: string;
  fileName: string;
  lastModified: string | null;
  imported: boolean;
}

export interface PendingSqlDumpScansPage {
  items: PendingSqlDumpScanItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface DeleteDatabaseResult {
  id: string;
  name: string;
  deletedDatasetTemplates: number;
  reclaimedSandboxInstances: number;
}

// ─── Leaderboard ──────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  points: number;
  challengesCompleted: number;
  streak: number;
}

/** GET /leaderboard — top N rows plus the signed-in user’s row (any rank), even when outside the top N. */
export interface GlobalLeaderboardPayload {
  entries: LeaderboardEntry[];
  viewer: LeaderboardEntry | null;
}

export interface AuthResult {
  user: User;
  tokens: AuthTokens;
}

interface PaginatedPayload<T> {
  items: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

function normalizeRole(role?: string): UserRole {
  return role === 'admin' ? 'admin' : 'user';
}

function normalizeUser(user: UserPayload): User {
  const sourceRoles = user.roles ?? (user.role ? [user.role] : []);
  const role = sourceRoles.includes('admin') || user.role === 'admin' ? 'admin' : 'user';

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName ?? user.username,
    avatarUrl: user.avatarUrl ?? null,
    role: normalizeRole(role),
    roles: [role],
    status: user.status,
    bio: user.bio ?? null,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt ?? null,
    updatedAt: user.updatedAt,
    stats: user.stats,
  };
}

function normalizePaginatedPayload<T>(payload: PaginatedPayload<T>): PaginatedResponse<T> {
  return {
    items: payload.items ?? [],
    total: payload.meta?.total ?? 0,
    page: payload.meta?.page ?? 1,
    limit: payload.meta?.limit ?? payload.items?.length ?? 0,
    totalPages: payload.meta?.totalPages ?? 1,
  };
}

function normalizeTrack(track: Track): Track {
  const status = track.status ?? (track.isPublished ? 'published' : 'draft');

  return {
    ...track,
    description: track.description ?? '',
    coverUrl: track.coverUrl ?? null,
    status,
    thumbnailUrl: track.thumbnailUrl ?? track.coverUrl ?? undefined,
    isPublished: track.isPublished ?? status === 'published',
    tags: track.tags ?? [],
  };
}

function normalizeLesson(lesson: Lesson): Lesson {
  return {
    ...lesson,
    description: lesson.description ?? '',
  };
}

function normalizeLearningSession(session: LearningSession): LearningSession {
  const scaleContext = resolveDatasetScaleContext(session);
  return {
    ...session,
    sourceScale: scaleContext.sourceScale,
    selectedScale: scaleContext.selectedScale,
    availableScales: scaleContext.availableScales,
    rowCount: scaleContext.rowCount,
    sourceRowCount: scaleContext.sourceRowCount,
  };
}

function normalizeDatabase(database: Database): Database {
  const scaleContext = resolveDatasetScaleContext(database);

  return {
    ...database,
    sourceScale: scaleContext.sourceScale,
    selectedScale: scaleContext.selectedScale,
    availableScales: scaleContext.availableScales,
    sourceRowCount: scaleContext.sourceRowCount,
  };
}

function normalizeChallengeSummary(challenge: LessonChallengeSummary): LessonChallengeSummary {
  return {
    ...challenge,
    description: challenge.description ?? '',
  };
}

function normalizeLessonVersion(version: LessonVersion): LessonVersion {
  return {
    ...version,
    content: version.content ?? '',
    starterQuery: version.starterQuery ?? null,
    challenges: Array.isArray(version.challenges)
      ? version.challenges.map(normalizeChallengeSummary)
      : [],
  };
}

function normalizeChallengeVersionDetail(
  detail: ChallengeVersionDetail,
): ChallengeVersionDetail {
  return {
    ...detail,
    visibility: detail.visibility ?? 'public',
    description: detail.description ?? '',
    points: detail.points ?? 100,
    hintText: detail.hintText ?? null,
    expectedResultColumns: Array.isArray(detail.expectedResultColumns)
      ? detail.expectedResultColumns.filter((value): value is string => typeof value === 'string')
      : [],
    validatorConfig:
      detail.validatorConfig && typeof detail.validatorConfig === 'object'
        ? detail.validatorConfig
        : null,
  };
}

function normalizeChallengeCatalogItem(item: ChallengeCatalogItem): ChallengeCatalogItem {
  return {
    ...item,
    visibility: item.visibility ?? 'public',
    description: item.description ?? '',
    datasetScale: normalizeDatasetScale(item.datasetScale) ?? 'small',
    publishedVersionId: item.publishedVersionId ?? null,
    latestVersionId: item.latestVersionId ?? null,
    latestVersionNo: item.latestVersionNo ?? null,
    validatorType: item.validatorType ?? null,
    latestVersionReviewStatus: item.latestVersionReviewStatus ?? null,
    latestVersionReviewNotes: item.latestVersionReviewNotes ?? null,
    latestVersionReviewedAt: item.latestVersionReviewedAt ?? null,
  };
}

function normalizeChallengeReviewItem(item: ChallengeReviewItem): ChallengeReviewItem {
  return {
    ...normalizeChallengeCatalogItem(item),
    createdBy: {
      id: item.createdBy?.id ?? null,
      username: item.createdBy?.username ?? null,
      displayName: item.createdBy?.displayName ?? item.createdBy?.username ?? null,
    },
  };
}

function normalizeAdminChallengeCatalogItem(item: AdminChallengeCatalogItem): AdminChallengeCatalogItem {
  return {
    ...normalizeChallengeReviewItem(item),
    catalogDomain: item.catalogDomain,
  };
}

function normalizeEditableChallengeDetail(detail: EditableChallengeDetail): EditableChallengeDetail {
  return {
    ...detail,
    visibility: detail.visibility ?? 'public',
    invitedUserIds: detail.invitedUserIds ?? [],
    description: detail.description ?? '',
    datasetScale: normalizeDatasetScale(detail.datasetScale) ?? 'small',
    publishedVersionId: detail.publishedVersionId ?? null,
    latestVersion: {
      ...detail.latestVersion,
      hintText: detail.latestVersion.hintText ?? null,
      expectedResultColumns: Array.isArray(detail.latestVersion.expectedResultColumns)
        ? detail.latestVersion.expectedResultColumns.filter((value): value is string => typeof value === 'string')
        : [],
      referenceSolution: detail.latestVersion.referenceSolution ?? null,
      validatorConfig:
        detail.latestVersion.validatorConfig && typeof detail.latestVersion.validatorConfig === 'object'
          ? detail.latestVersion.validatorConfig
          : null,
      reviewNotes: detail.latestVersion.reviewNotes ?? null,
      reviewedBy: detail.latestVersion.reviewedBy ?? null,
      reviewedAt: detail.latestVersion.reviewedAt ?? null,
      publishedAt: detail.latestVersion.publishedAt ?? null,
    },
  };
}

function normalizeLessonVersionSummary(item: LessonVersionSummary): LessonVersionSummary {
  return {
    ...item,
    schemaTemplateId: item.schemaTemplateId ?? null,
    datasetTemplateId: item.datasetTemplateId ?? null,
    publishedAt: item.publishedAt ?? null,
  };
}

function normalizeAdminLessonVersionDetail(detail: AdminLessonVersionDetail): AdminLessonVersionDetail {
  return {
    ...detail,
    content: detail.content ?? '',
    starterQuery: detail.starterQuery ?? null,
    schemaTemplateId: detail.schemaTemplateId ?? null,
    datasetTemplateId: detail.datasetTemplateId ?? null,
    publishedAt: detail.publishedAt ?? null,
    createdBy: detail.createdBy ?? null,
  };
}

function normalizeSystemJob(job: RawSystemJob): SystemJob {
  const payload = job.payload && typeof job.payload === 'object' ? job.payload : null;
  const target =
    (typeof payload?.schemaName === 'string' && payload.schemaName) ||
    (typeof payload?.schemaTemplateId === 'string' && payload.schemaTemplateId) ||
    (typeof payload?.sourceDatasetTemplateId === 'string' && payload.sourceDatasetTemplateId) ||
    undefined;

  return {
    id: job.id,
    type: job.type,
    status: job.status,
    target,
    startedAt: job.startedAt ?? job.scheduledAt ?? job.createdAt,
    completedAt: job.completedAt ?? undefined,
    errorMessage: job.errorMessage ?? undefined,
  };
}

function normalizeSqlDumpImportResult(payload: unknown): SqlDumpImportResult {
  if (!payload || typeof payload !== 'object') {
    return {
      schemaTemplateId: '',
      datasetTemplateId: null,
    };
  }

  const result = payload as {
    schemaTemplateId?: string;
    datasetTemplateId?: string | null;
    databaseId?: string;
    schemaTemplate?: { id?: string; catalogAnchorId?: string };
    sourceDatasetTemplate?: { id?: string };
  };

  const schemaTemplateId = result.schemaTemplateId ?? result.schemaTemplate?.id ?? '';
  return {
    schemaTemplateId,
    datasetTemplateId:
      result.datasetTemplateId ??
      result.sourceDatasetTemplate?.id ??
      null,
    databaseId:
      result.databaseId ??
      result.schemaTemplate?.catalogAnchorId ??
      schemaTemplateId,
  };
}

// ─── Axios Instance ───────────────────────────────────────────────────────────

const api: AxiosInstance = axios.create({
  // Same-origin by default: works for localhost and domain+reverse-proxy setups.
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? '/v1',
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor – attach bearer token
api.interceptors.request.use((config) => {
  const nextConfig = config as ApiInternalRequestConfig;

  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('sqlcraft-auth');
      if (raw) {
        const parsed = JSON.parse(raw) as { state?: { tokens?: { accessToken?: string } } };
        const token = parsed?.state?.tokens?.accessToken;
        if (token) {
          nextConfig.headers.Authorization = `Bearer ${token}`;
        }
      }
    } catch {
      // ignore parse errors
    }
  }
  return nextConfig;
});

// Response interceptor – unwrap envelope & handle 401
api.interceptors.response.use(
  (response: AxiosResponse<ApiResponse>) => {
    // Unwrap the standard envelope
    if (response.data && typeof response.data === 'object' && 'data' in response.data) {
      response.data = response.data.data as never;
    }
    return response;
  },
  (error: unknown) => {
    const axiosError = error as AxiosError<ApiResponse>;
    const requestConfig = axiosError.config as ApiInternalRequestConfig | undefined;

    if (
      axiosError.response?.status === 401 &&
      typeof window !== 'undefined' &&
      !requestConfig?.skipAuthRedirect
    ) {
      localStorage.removeItem('sqlcraft-auth');
      window.location.assign('/login');
    }

    // Extract backend error message if available
    const message =
      axiosError.response?.data?.message ?? axiosError.message ?? 'An unexpected error occurred';
    const status = axiosError.response?.status;

    const normalizedError = new Error(message) as Error & {
      status?: number;
      code?: string;
      details?: unknown;
    };
    normalizedError.status = status;
    normalizedError.code = axiosError.code;
    normalizedError.details = axiosError.response?.data;

    return Promise.reject(normalizedError);
  }
);

// ─── Auth API ─────────────────────────────────────────────────────────────────

export const authApi = {
  login: (payload: LoginPayload) =>
    api
      .post<{ user: UserPayload; tokens: AuthTokens }>(
        '/auth/login',
        payload,
        { skipAuthRedirect: true },
      )
      .then((r) => ({
        ...r.data,
        user: normalizeUser(r.data.user),
      }) satisfies AuthResult),

  register: (payload: RegisterPayload) =>
    api
      .post<{ user: UserPayload; tokens: AuthTokens }>(
        '/auth/register',
        payload,
        { skipAuthRedirect: true },
      )
      .then((r) => ({
        ...r.data,
        user: normalizeUser(r.data.user),
      }) satisfies AuthResult),

  logout: () => api.post('/auth/logout').then((r) => r.data),

  refreshToken: (refreshToken: string) =>
    api
      .post<AuthTokens>(
        '/auth/refresh',
        { refreshToken },
        { skipAuthRedirect: true },
      )
      .then((r) => r.data),

  me: (accessToken?: string) =>
    api
      .get<UserPayload>('/auth/me', {
        skipAuthRedirect: Boolean(accessToken),
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      })
      .then((r) => normalizeUser(r.data)),
};

// ─── Tracks API ───────────────────────────────────────────────────────────────

export const tracksApi = {
  list: (params?: { difficulty?: string; page?: number; limit?: number }) =>
    api
      .get<PaginatedPayload<Track>>('/tracks', {
        params: { page: params?.page, limit: params?.limit },
      })
      .then((r) => normalizePaginatedPayload(r.data))
      .then((page) => ({
        ...page,
        items: page.items.map(normalizeTrack).filter((track) =>
          params?.difficulty ? track.difficulty === params.difficulty : true
        ),
      })),

  get: (idOrSlug: string) =>
    api
      .get<Track & { lessons?: Lesson[] }>(`/tracks/${idOrSlug}`)
      .then((r) => ({
        ...normalizeTrack(r.data),
        lessons: Array.isArray(r.data.lessons) ? r.data.lessons.map(normalizeLesson) : [],
      })),

  /** Convenience: get track then extract its embedded lessons list */
  getLessons: (trackId: string) =>
    api
      .get<Track & { lessons?: Lesson[] }>(`/tracks/${trackId}`)
      .then((r) => (r.data.lessons ?? []).map(normalizeLesson)),

  create: (payload: Partial<Track>) =>
    api.post<Track>('/tracks', payload).then((r) => r.data),

  update: (id: string, payload: Partial<Track>) =>
    api.patch<Track>(`/tracks/${id}`, payload).then((r) => r.data),

  delete: (id: string) => api.delete(`/tracks/${id}`).then((r) => r.data),
};

// ─── Lessons API ──────────────────────────────────────────────────────────────

export const lessonsApi = {
  get: (id: string) =>
    api.get<Lesson>(`/lessons/${id}`).then((r) => normalizeLesson(r.data)),

  getVersion: (id: string) =>
    api.get<LessonVersion>(`/lesson-versions/${id}`).then((r) => normalizeLessonVersion(r.data)),

  create: (payload: Partial<Lesson>) =>
    api.post<Lesson>('/lessons', payload).then((r) => r.data),

  update: (id: string, payload: Partial<Lesson>) =>
    api.patch<Lesson>(`/lessons/${id}`, payload).then((r) => r.data),

  delete: (id: string) => api.delete(`/lessons/${id}`).then((r) => r.data),
};

export const challengesApi = {
  listPublished: () =>
    api
      .get<ChallengeCatalogItem[]>('/challenges')
      .then((r) => r.data.map(normalizeChallengeCatalogItem)),

  listMine: () =>
    api
      .get<ChallengeCatalogItem[]>('/challenges/mine')
      .then((r) => r.data.map(normalizeChallengeCatalogItem)),

  validateDraft: (payload: {
    challengeId?: string;
    databaseId: string;
    slug: string;
    title: string;
    description?: string;
    difficulty?: 'beginner' | 'intermediate' | 'advanced';
    sortOrder?: number;
    points?: number;
    datasetScale?: DatasetScale;
    visibility?: 'public' | 'private';
    invitedUserIds?: string[];
    problemStatement: string;
    hintText?: string;
    expectedResultColumns?: string[];
    referenceSolution?: string;
    validatorType?: string;
    validatorConfig: ChallengeValidatorConfigPayload;
  }) =>
    api
      .post<ChallengeDraftValidationResult>('/challenges/validate', payload)
      .then((r) => r.data),

  create: (payload: {
    databaseId: string;
    slug: string;
    title: string;
    description?: string;
    difficulty?: 'beginner' | 'intermediate' | 'advanced';
    sortOrder?: number;
    points?: number;
    datasetScale?: DatasetScale;
    problemStatement: string;
    hintText?: string;
    expectedResultColumns?: string[];
    referenceSolution?: string;
    validatorType?: string;
    validatorConfig: ChallengeValidatorConfigPayload;
    visibility?: 'public' | 'private';
    invitedUserIds?: string[];
  }) => api.post<{ challenge: { id: string }; version: { id: string } }>('/challenges', payload).then((r) => r.data),

  createVersion: (
    challengeId: string,
    payload: {
      databaseId: string;
      slug: string;
      title: string;
      description?: string;
      difficulty?: 'beginner' | 'intermediate' | 'advanced';
      sortOrder?: number;
      points?: number;
      datasetScale?: DatasetScale;
      problemStatement: string;
      hintText?: string;
      expectedResultColumns?: string[];
      referenceSolution?: string;
      validatorType?: string;
      validatorConfig: ChallengeValidatorConfigPayload;
    },
  ) =>
    api
      .post<{ challenge: { id: string }; version: { id: string } }>(
        `/challenges/${challengeId}/versions`,
        payload,
      )
      .then((r) => r.data),

  getDraft: (challengeId: string) =>
    api
      .get<EditableChallengeDetail>(`/challenges/${challengeId}/draft`)
      .then((r) => normalizeEditableChallengeDetail(r.data)),

  getVersion: (id: string) =>
    api
      .get<ChallengeVersionDetail>(`/challenge-versions/${id}`)
      .then((r) => normalizeChallengeVersionDetail(r.data)),

  publishPrivate: (challengeId: string, versionId: string) =>
    api.post(`/challenges/${challengeId}/publish-private`, { versionId }).then((r) => r.data),

  listInvites: (challengeId: string) =>
    api.get<{ userIds: string[] }>(`/challenges/${challengeId}/invites`).then((r) => r.data),

  replaceInvites: (challengeId: string, userIds: string[]) =>
    api.put<{ userIds: string[] }>(`/challenges/${challengeId}/invites`, { userIds }).then((r) => r.data),

  submitAttempt: (payload: {
    learningSessionId: string;
    challengeVersionId?: string;
    queryExecutionId: string;
  }) => api.post<ChallengeAttempt>('/challenge-attempts', payload).then((r) => r.data),

  listAttempts: (challengeVersionId: string) =>
    api
      .get<ChallengeAttempt[]>('/challenge-attempts', { params: { challengeVersionId } })
      .then((r) => r.data),

  getLeaderboard: (challengeVersionId: string, limit = 10) =>
    api
      .get<ChallengeLeaderboardEntry[]>(`/challenge-versions/${challengeVersionId}/leaderboard`, {
        params: { limit },
      })
      .then((r) => r.data),

  getLeaderboardContext: (challengeVersionId: string, limit = 25) =>
    api
      .get<ChallengeLeaderboardContext>(`/challenge-versions/${challengeVersionId}/leaderboard/context`, {
        params: { limit },
      })
      .then((r) => r.data),

  listReviewQueue: () =>
    api
      .get<ChallengeReviewItem[]>('/admin/challenges')
      .then((r) => r.data.map(normalizeChallengeReviewItem)),

  listAdminCatalog: (params?: {
    page?: number;
    limit?: number;
    databaseId?: string;
    domain?: DatabaseDomain;
    status?: 'draft' | 'published' | 'archived' | 'all';
  }) =>
    api.get<AdminChallengesCatalogPage>('/admin/challenges/catalog', { params }).then((r) => {
      const data = r.data as AdminChallengesCatalogPage | undefined;
      const rawItems = Array.isArray(data?.items) ? data.items : [];
      return {
        ...(data ?? { total: 0, page: 1, limit: params?.limit ?? 20, totalPages: 0 }),
        items: rawItems.map(normalizeAdminChallengeCatalogItem),
      };
    }),

  publishVersion: (versionId: string) =>
    api.post(`/admin/challenge-versions/${versionId}/publish`).then((r) => r.data),

  reviewVersion: (
    versionId: string,
    payload: { decision: 'approve' | 'request_changes' | 'reject'; note?: string },
  ) => api.post(`/admin/challenge-versions/${versionId}/review`, payload).then((r) => r.data),
};

// ─── Sessions API ─────────────────────────────────────────────────────────────

export const sessionsApi = {
  list: () =>
    api.get<LearningSession[]>('/learning-sessions').then((r) => r.data.map(normalizeLearningSession)),

  get: (id: string) =>
    api.get<LearningSession>(`/learning-sessions/${id}`).then((r) => normalizeLearningSession(r.data)),

  heartbeat: (id: string) =>
    api
      .post<ApiResponse<LabSessionHeartbeatResponse>>(`/learning-sessions/${id}/heartbeat`)
      .then((r) => r.data.data),

  getSchema: (id: string) =>
    api.get<SessionSchemaResponse>(`/learning-sessions/${id}/schema`).then((r) => r.data),

  getSchemaDiff: (id: string) =>
    api.get<SessionSchemaDiffResponse>(`/learning-sessions/${id}/schema-diff`).then((r) => r.data),

  revertSchemaDiffChange: (id: string, payload: RevertSessionSchemaChangePayload) =>
    api.post(`/learning-sessions/${id}/schema-diff/revert`, payload).then((r) => r.data),

  create: (payload: { challengeVersionId: string }) =>
    api
      .post<{ session: LearningSession; sandbox: { id: string; status: string } }>(
        '/learning-sessions',
        { challengeVersionId: payload.challengeVersionId },
      )
      .then((r) => normalizeLearningSession(r.data.session)),

  end: (id: string) =>
    api.post<{ id: string; status: string; endedAt: string | null }>(
      `/learning-sessions/${id}/end`,
    ).then((r) => r.data),
};

export const sandboxesApi = {
  reset: (sessionId: string, selectedScale?: DatasetScale) =>
    api
      .post<{ sandboxId: string; status: string; requestedAt: string }>(
        `/sandboxes/${sessionId}/reset`,
        selectedScale
          ? {
              datasetSize: selectedScale,
            }
          : {},
      )
      .then((r) => r.data),
};

// ─── Query Execution API ──────────────────────────────────────────────────────

export const queryApi = {
  execute: (payload: QueryExecutionRequest) =>
    {
      const planMode = getExplainPlanMode(payload.sql);
      return api
        .post<QueryExecution>('/query-executions', {
          learningSessionId: payload.sessionId,
          sql: payload.sql,
          explainPlan: planMode != null,
          planMode: planMode ?? undefined,
        })
        .then((r) => normalizeQueryExecutionItem(r.data as unknown as Record<string, unknown>));
    },

  explain: (payload: QueryExecutionRequest) =>
    {
      const planMode = getExplainPlanMode(payload.sql);

      if (planMode == null) {
        return Promise.reject(
          new Error('Execution plan is only available for SELECT/INSERT/UPDATE/DELETE statements'),
        );
      }

      return api
        .post<QueryExecution>('/query-executions', {
          learningSessionId: payload.sessionId,
          sql: payload.sql,
          explainPlan: true,
          planMode,
        })
        .then((r) => normalizeQueryExecutionItem(r.data as unknown as Record<string, unknown>));
    },

  poll: (executionId: string) =>
    api
      .get<QueryExecution>(`/query-executions/${executionId}`)
      .then((r) => normalizeQueryExecutionItem(r.data as unknown as Record<string, unknown>)),

  history: async (sessionId?: string, params?: { page?: number; limit?: number }) => {
    const pagination = { ...params };

    const primaryPath = sessionId
      ? `/learning-sessions/${sessionId}/query-executions`
      : '/query-executions';

    const legacyPath = '/query-executions';

    try {
      const res = await api.get<PaginatedResponse<QueryExecution>>(primaryPath, {
        params: pagination,
      });
      return normalizeQueryHistoryPage(res.data);
    } catch {
      // Backward compatibility for older API servers.
      const res = await api.get<PaginatedResponse<QueryExecution>>(legacyPath, {
        params: { sessionId, ...pagination },
      });
      return normalizeQueryHistoryPage(res.data);
    }
  },
};

// ─── Users API ────────────────────────────────────────────────────────────────

export interface UpdateProfilePayload {
  displayName?: string;
  bio?: string;
}

export interface AdminCreateUserPayload {
  email: string;
  username: string;
  password: string;
  displayName?: string;
  bio?: string | null;
  role: UserRole;
  status?: 'active' | 'disabled' | 'invited';
}

export interface AdminUpdateUserPayload {
  email?: string;
  username?: string;
  password?: string;
  displayName?: string | null;
  bio?: string | null;
  role?: UserRole;
  status?: 'active' | 'disabled' | 'invited';
}

/** Row from GET /v1/users/invite-search — pick users for private invites. */
export interface InviteUserSearchItem {
  id: string;
  username: string;
  displayName: string | null;
}

export const usersApi = {
  /** Authed: search active users (excludes you) for private DB/challenge invites. */
  searchForInvite: (params?: { q?: string; limit?: number }) =>
    api
      .get<{ items: InviteUserSearchItem[] }>('/users/invite-search', { params })
      .then((r) => r.data.items),

  // Admin-only: list all users
  list: (params?: { search?: string; role?: UserRole; status?: string; page?: number }) =>
    api
      .get<PaginatedResponse<UserPayload & { roles: string[] }>>('/admin/users', { params })
      .then((r) => ({
        ...r.data,
        items: r.data.items.map((u) => normalizeUser(u)),
      })) as Promise<PaginatedResponse<User>>,

  get: (id: string) => api.get<User>(`/users/${id}`).then((r) => r.data),

  // Admin-only: update a user's role
  updateRole: (id: string, role: UserRole) =>
    api.patch<User>(`/admin/users/${id}/role`, { role }).then((r) => r.data),

  // Admin-only: create a user
  createAdmin: (data: AdminCreateUserPayload) =>
    api.post<UserPayload>('/admin/users', data).then((r) => normalizeUser(r.data)),

  // Admin-only: update a user
  updateAdmin: (id: string, data: AdminUpdateUserPayload) =>
    api.patch<UserPayload>(`/admin/users/${id}`, data).then((r) => normalizeUser(r.data)),

  // Admin-only: disable a user
  disable: (id: string) =>
    api.patch(`/admin/users/${id}/status`, { status: 'disabled' }).then((r) => r.data),

  // Admin-only: enable a user
  enable: (id: string) =>
    api.patch(`/admin/users/${id}/status`, { status: 'active' }).then((r) => r.data),

  // Admin-only: soft delete a user
  deleteAdmin: (id: string) =>
    api.delete<UserPayload>(`/admin/users/${id}`).then((r) => normalizeUser(r.data)),

  // Current user: update own profile
  updateMe: (data: UpdateProfilePayload) =>
    api.patch<UserPayload>('/users/me', data).then((r) => normalizeUser(r.data)),

  // Current user: change password
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post('/users/me/change-password', { currentPassword, newPassword }).then((r) => r.data),

  // Current user: upload avatar
  uploadAvatar: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api
      .post<{ avatarUrl: string }>('/users/me/avatar', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  },
};

// ─── Admin API ────────────────────────────────────────────────────────────────

/** Matches server `PassCriterionSchema` / `ChallengeValidatorConfigSchema`. */
export type PassCriterionPayload =
  | { type: 'max_query_duration_ms'; maxMs: number }
  | { type: 'max_explain_total_cost'; maxTotalCost: number }
  | { type: 'requires_index_usage' }
  | {
      type: 'required_output_columns';
      columns: string[];
      /** Schema-aware picks (table + column); optional for legacy configs. */
      selections?: Array<{ table: string; column: string }>;
    }
  | { type: 'required_tables_in_query'; tables: string[]; matchMode?: 'all' | 'any' };

export type ChallengeValidatorConfigPayload = {
  passCriteria: PassCriterionPayload[];
};

/** POST /admin/challenges — creates a draft challenge and version 1 (admin-only). */
export interface AdminCreateChallengePayload {
  databaseId: string;
  slug: string;
  title: string;
  description?: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  sortOrder?: number;
  points?: number;
  datasetScale?: DatasetScale;
  visibility?: 'public' | 'private';
  invitedUserIds?: string[];
  problemStatement: string;
  hintText?: string;
  expectedResultColumns?: string[];
  referenceSolution?: string;
  validatorType?: string;
  validatorConfig: ChallengeValidatorConfigPayload;
}

export interface AdminCreateChallengeResult {
  challenge: {
    id: string;
    databaseId: string;
    slug: string;
    title: string;
    description: string | null;
    difficulty: string;
    sortOrder: number;
    points: number;
    datasetScale?: DatasetScale;
    visibility?: 'public' | 'private';
    status: string;
    publishedVersionId: string | null;
    createdBy: string | null;
    createdAt: string;
    updatedAt: string;
  };
  version: {
    id: string;
    challengeId: string;
    versionNo: number;
    problemStatement: string;
    hintText: string | null;
    validatorType: string;
    isPublished: boolean;
    reviewStatus: string;
    createdAt: string;
  };
}

export const adminApi = {
  getConfig: () => api.get<AdminConfigRecord>('/admin/config').then((r) => r.data),

  updateConfig: (config: AdminConfig) =>
    api.put<AdminConfigRecord>('/admin/config', config).then((r) => r.data),

  resetConfig: () => api.post<AdminConfigRecord>('/admin/config/reset').then((r) => r.data),

  systemHealth: () => api.get<AdminSystemHealth>('/admin/system/health').then((r) => r.data),

  systemJobs: (params?: {
    limit?: number;
    status?: SystemJob['status'];
    type?: string;
  }) =>
    api
      .get<RawSystemJob[]>('/admin/system/jobs', { params })
      .then((r) => r.data.map(normalizeSystemJob)),

  auditLogs: (params?: {
    page?: number;
    limit?: number;
    action?: string;
    resourceType?: string;
  }) =>
    api.get<AdminAuditLogsPage>('/admin/system/audit-logs', { params }).then((r) => r.data),

  metrics: async () => {
    const health = await adminApi.systemHealth();
    return {
      activeSandboxes: health.stats.activeSessions,
      totalUsers: health.stats.users,
      querySuccessRate: 0,
      p95LatencyMs: 0,
      totalQueriesLast24h: 0,
      errorRate: 0,
    } satisfies SystemMetrics;
  },

  jobs: (params?: { limit?: number; status?: SystemJob['status']; type?: string }) =>
    adminApi.systemJobs(params),

  terminateAllSandboxes: () =>
    api.post('/admin/sandboxes/terminate-all').then((r) => r.data),

  triggerMigration: () =>
    api.post('/admin/migrations/run').then((r) => r.data),

  clearStaleSessions: () =>
    api
      .post<ClearStaleSessionsResult>('/admin/system/sessions/clear-stale')
      .then((r) => r.data),

  deleteDatabase: (databaseId: string) =>
    api
      .delete<DeleteDatabaseResult>(`/admin/databases/${databaseId}`)
      .then((r) => r.data),

  listPendingSchemaTemplateReviews: () =>
    api
      .get<PendingSchemaTemplateReviewItem[]>('/admin/databases/schema-templates/pending-review')
      .then((r) => r.data),

  approveSchemaTemplateReview: (schemaTemplateId: string) =>
    api
      .post<{ ok: boolean }>(
        `/admin/databases/schema-templates/${schemaTemplateId}/approve-review`,
      )
      .then((r) => r.data),

  rejectSchemaTemplateReview: (schemaTemplateId: string) =>
    api
      .post<{ ok: boolean }>(
        `/admin/databases/schema-templates/${schemaTemplateId}/reject-review`,
      )
      .then((r) => r.data),

  createChallenge: (payload: AdminCreateChallengePayload) =>
    api.post<AdminCreateChallengeResult>('/admin/challenges', payload).then((r) => r.data),

  updateChallenge: (challengeId: string, payload: AdminCreateChallengePayload) =>
    api
      .patch<AdminCreateChallengeResult>(`/admin/challenges/${challengeId}`, payload)
      .then((r) => r.data),

  deleteChallenge: (challengeId: string) => api.delete(`/admin/challenges/${challengeId}`),

  listLessonVersions: (lessonId: string) =>
    api
      .get<LessonVersionSummary[]>(`/admin/lessons/${lessonId}/versions`)
      .then((r) => r.data.map(normalizeLessonVersionSummary)),

  getLessonVersion: (versionId: string) =>
    api
      .get<AdminLessonVersionDetail>(`/admin/lesson-versions/${versionId}`)
      .then((r) => normalizeAdminLessonVersionDetail(r.data)),

  createLessonVersion: (payload: {
    lessonId: string;
    title: string;
    content: string;
    starterQuery?: string;
    schemaTemplateId?: string;
    datasetTemplateId?: string;
  }) => api.post<AdminLessonVersionDetail>('/admin/lesson-versions', payload).then((r) => normalizeAdminLessonVersionDetail(r.data)),

  publishLessonVersion: (versionId: string) =>
    api.post<AdminLessonVersionDetail>(`/admin/lesson-versions/${versionId}/publish`).then((r) =>
      normalizeAdminLessonVersionDetail(r.data),
    ),

  globalLeaderboard: (period: 'weekly' | 'monthly' | 'alltime' = 'alltime', limit = 10) =>
    leaderboardApi.get(period, limit),
};

// ─── Databases API ────────────────────────────────────────────────────────────

/** `prefix` is `/admin/databases` or `/databases` (authenticated user uploads). */
async function scanSqlDumpViaPresignedStorage(
  file: File,
  options: { artifactOnly?: boolean; prefix: string },
): Promise<SqlDumpScanResult> {
  const { prefix } = options;
  const session = await api
    .post<SqlDumpDirectUploadSessionCreateResult>(`${prefix}/sql-dump-upload-sessions`, {
      fileName: file.name || 'dump.sql',
      byteSize: file.size,
      artifactOnly: options?.artifactOnly,
    })
    .then((r) => r.data);

  const abort = () =>
    api.post(`${prefix}/sql-dump-upload-sessions/${session.sessionId}/abort`, {}).catch(() => undefined);

  if (session.mode === 'single') {
    const putRes = await fetch(session.putUrl, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': 'application/sql' },
    });
    if (!putRes.ok) {
      await abort();
      throw new Error(`Direct upload failed (${putRes.status})`);
    }
    return api
      .post<SqlDumpScanResult>(
        `${prefix}/sql-dump-upload-sessions/${session.sessionId}/complete`,
        {},
        { timeout: 600_000 },
      )
      .then((r) => r.data);
  }

  const { partSize, totalParts, sessionId } = session;
  const parts: { partNumber: number; etag: string }[] = [];
  for (let p = 1; p <= totalParts; p++) {
    const start = (p - 1) * partSize;
    const end = Math.min(start + partSize, file.size);
    const blob = file.slice(start, end);
    const { url } = await api
      .post<SqlDumpUploadPresignPartResult>(
        `${prefix}/sql-dump-upload-sessions/${sessionId}/presign-part`,
        { partNumber: p },
        { timeout: 120_000 },
      )
      .then((r) => r.data);
    const res = await fetch(url, { method: 'PUT', body: blob });
    if (!res.ok) {
      await abort();
      throw new Error(`Part ${p} upload failed (${res.status})`);
    }
    const etag = res.headers.get('etag') ?? res.headers.get('ETag');
    if (!etag) {
      await abort();
      throw new Error(
        'Missing ETag on upload response. Configure object storage CORS to expose ETag for PUT.',
      );
    }
    parts.push({ partNumber: p, etag });
  }

  return api
    .post<SqlDumpScanResult>(
      `${prefix}/sql-dump-upload-sessions/${sessionId}/complete`,
      { parts },
      { timeout: 600_000 },
    )
    .then((r) => r.data);
}

export const databasesApi = {
  list: (params?: {
    domain?: string;
    scale?: string;
    difficulty?: string;
    dialect?: string;
    /** Substring search on name, slug, description, engine, tags */
    q?: string;
    page?: number;
    limit?: number;
    /** Requires auth: include your private DBs and those you are invited to (challenge authoring). */
    forChallengeAuthoring?: boolean;
  }) =>
    api
      .get<PaginatedResponse<Database>>('/databases', { params })
      .then((r) => ({
        ...r.data,
        items: r.data.items.map(normalizeDatabase),
      })),

  get: (id: string, opts?: { forChallengeAuthoring?: boolean }) =>
    api
      .get<Database>(`/databases/${id}`, {
        params: opts?.forChallengeAuthoring ? { forChallengeAuthoring: true } : undefined,
      })
      .then((r) => normalizeDatabase(r.data)),

  createSession: (databaseId: string, scale?: DatabaseScale) =>
    api
      .post<{ session: LearningSession; sandbox: { id: string; status: string } }>(
        '/databases/sessions',
        { databaseId, scale },
      )
      .then((r) => normalizeLearningSession(r.data.session)),

  scanSqlDump: (file: File, options?: { artifactOnly?: boolean }) => {
    if (file.size >= SQL_DUMP_DIRECT_UPLOAD_MIN_BYTES) {
      return scanSqlDumpViaPresignedStorage(file, { ...options, prefix: '/admin/databases' });
    }
    const form = new FormData();
    form.append('dump', file);
    if (options?.artifactOnly) {
      form.append('artifactOnly', 'true');
    }
    return api
      .post<SqlDumpScanResult>('/admin/databases/scan', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 600_000,
      })
      .then((r) => r.data);
  },

  /** Current user: scan then POST import-from-scan (visibility / invites). */
  userScanSqlDump: (file: File, options?: { artifactOnly?: boolean }) => {
    if (file.size >= SQL_DUMP_DIRECT_UPLOAD_MIN_BYTES) {
      return scanSqlDumpViaPresignedStorage(file, { ...options, prefix: '/databases' });
    }
    const form = new FormData();
    form.append('dump', file);
    if (options?.artifactOnly) {
      form.append('artifactOnly', 'true');
    }
    return api
      .post<SqlDumpScanResult>('/databases/scan', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 600_000,
      })
      .then((r) => r.data);
  },

  userImportFromScan: (payload: UserSqlDumpImportPayload) =>
    api
      .post<SqlDumpImportResult>('/databases/import-from-scan', payload)
      .then((r) => normalizeSqlDumpImportResult(r.data)),

  userGetSqlDumpScan: (scanId: string) =>
    api.get<SqlDumpScanResult>(`/databases/scans/${scanId}`).then((r) => r.data),

  importFromScan: (payload: SqlDumpImportPayload) =>
    api
      .post<SqlDumpImportResult>('/admin/databases/import', payload)
      .then((r) => normalizeSqlDumpImportResult(r.data)),

  listPendingScans: (params?: { page?: number; limit?: number }) =>
    api
      .get<PendingSqlDumpScansPage>('/admin/databases/pending-scans', { params })
      .then((r) => r.data),

  getSqlDumpScan: (scanId: string) =>
    api.get<SqlDumpScanResult>(`/admin/databases/scans/${scanId}`).then((r) => r.data),
};

// ─── Leaderboard API ──────────────────────────────────────────────────────────

export const leaderboardApi = {
  get: (period: 'weekly' | 'monthly' | 'alltime' = 'alltime', limit = 50) =>
    api
      .get<GlobalLeaderboardPayload>('/leaderboard', { params: { period, limit } })
      .then((r) => r.data),
};

export default api;
