// API Response wrapper
export interface ApiResponse<T = unknown> {
  success: boolean;
  code: string;
  message: string;
  data: T;
}

export interface PaginatedData<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// ── API code catalog ────────────────────────────────────────────────────────
// Values are 4-digit numeric strings.
// Import ApiCode and use ApiCode.SUCCESS, ApiCode.NOT_FOUND, etc.
// Never hardcode the string literals ('0000', '2002') in application code.
export const ApiCode = {
  // 0xxx — Success
  SUCCESS:                     '0000', // Standard 200 success
  CREATED:                     '0001', // Resource created (201)
  ACCEPTED:                    '0002', // Async job accepted (202)

  // 1xxx — Auth / Identity
  UNAUTHORIZED:                '1001', // No token or missing Authorization header
  FORBIDDEN:                   '1002', // Valid token but insufficient role
  TOKEN_EXPIRED:               '1003', // JWT exp claim in the past
  TOKEN_INVALID:               '1004', // Malformed or tampered JWT
  INVALID_CREDENTIALS:         '1005', // Wrong email or password

  // 2xxx — Validation & Resource
  VALIDATION_ERROR:            '2001', // Zod or input validation failed
  NOT_FOUND:                   '2002', // Requested resource does not exist
  ALREADY_EXISTS:              '2003', // Unique constraint / duplicate
  CONFLICT:                    '2004', // State conflict (e.g. already ended)

  // 3xxx — Session & Sandbox lifecycle
  SESSION_NOT_READY:           '3001', // Session still provisioning
  SESSION_EXPIRED:             '3002', // Session TTL exceeded
  SESSION_NOT_FOUND:           '3003', // Session ID unknown
  SANDBOX_NOT_READY:           '3004', // Sandbox still provisioning
  SANDBOX_PROVISIONING_FAILED: '3005', // Sandbox failed to start
  SANDBOX_BUSY:                '3006', // Sandbox processing another query

  // 4xxx — Query execution
  QUERY_BLOCKED:               '4001', // Blocked statement type (DROP, etc.)
  QUERY_TIMEOUT:               '4002', // statement_timeout exceeded
  QUERY_EXECUTION_FAILED:      '4003', // PostgreSQL returned an error
  QUERY_SYNTAX_ERROR:          '4004', // SQL syntax error
  QUERY_RESULT_TOO_LARGE:      '4005', // Result exceeds row / byte cap

  // 5xxx — Content
  CONTENT_NOT_PUBLISHED:       '5001', // Draft or archived content accessed
  CONTENT_VERSION_NOT_FOUND:   '5002', // Specific version does not exist

  // 6xxx — Rate limiting
  RATE_LIMITED:                '6001', // Too many requests

  // 9xxx — Server errors
  INTERNAL_ERROR:              '9001', // Unhandled exception
  SERVICE_UNAVAILABLE:         '9002', // Dependency (DB, Redis) unreachable
} as const;

// Derive a union type from the values so params can be typed as ApiCode
export type ApiCode = typeof ApiCode[keyof typeof ApiCode];

/**
 * Logical SQL engine family for schema templates, catalog filters, and sandboxes.
 * Legacy rows may still store `postgresql-16` / `mysql-8` / `sqlite-3`; normalize at boundaries.
 */
export const SCHEMA_SQL_ENGINE_VALUES = [
  'postgresql',
  'mysql',
  'mariadb',
  'sqlserver',
  'sqlite',
] as const;
export type SchemaSqlEngine = (typeof SCHEMA_SQL_ENGINE_VALUES)[number];

/** @deprecated Prefer SchemaSqlEngine; kept as alias for existing imports. */
export const SCHEMA_SQL_DIALECT_VALUES = SCHEMA_SQL_ENGINE_VALUES;
export type SchemaSqlDialect = SchemaSqlEngine;

const LEGACY_DIALECT_MAP: Record<string, SchemaSqlEngine> = {
  'postgresql-16': 'postgresql',
  'mysql-8': 'mysql',
  'sqlite-3': 'sqlite',
};

export function normalizeSchemaSqlEngine(raw: string | null | undefined): SchemaSqlEngine {
  const v = (raw ?? '').trim().toLowerCase();
  if (!v) return 'postgresql';
  if ((SCHEMA_SQL_ENGINE_VALUES as readonly string[]).includes(v)) {
    return v as SchemaSqlEngine;
  }
  const mapped = LEGACY_DIALECT_MAP[v];
  if (mapped) return mapped;
  return 'postgresql';
}

// Domain types
export interface User {
  id: string;
  email: string;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  status: UserStatus;
  createdAt: string;
  updatedAt: string;
}

export type UserStatus = 'active' | 'disabled' | 'invited';

export interface Track {
  id: string;
  slug: string;
  title: string;
  description?: string;
  coverUrl?: string;
  difficulty: Difficulty;
  status: ContentStatus;
  sortOrder: number;
  lessonCount: number;
  createdAt: string;
  updatedAt: string;
}

export type Difficulty = 'beginner' | 'intermediate' | 'advanced';
export type ContentStatus = 'draft' | 'published' | 'archived';

export interface Lesson {
  id: string;
  trackId: string;
  slug: string;
  title: string;
  description?: string;
  difficulty: Difficulty;
  status: ContentStatus;
  sortOrder: number;
  estimatedMinutes?: number;
  publishedVersionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LessonVersion {
  id: string;
  lessonId: string;
  versionNo: number;
  title: string;
  content: string;
  isPublished: boolean;
  schemaTemplateId?: string;
  datasetTemplateId?: string;
  publishedAt?: string;
  createdAt: string;
}

export interface Challenge {
  id: string;
  lessonId: string;
  slug: string;
  title: string;
  description?: string;
  difficulty: Difficulty;
  sortOrder: number;
  status: ContentStatus;
  createdAt: string;
}

export interface ChallengeVersion {
  id: string;
  challengeId: string;
  versionNo: number;
  problemStatement: string;
  expectedResultColumns?: string[];
  validatorType: string;
  isPublished: boolean;
  publishedAt?: string;
  createdAt: string;
}

export interface LearningSession {
  id: string;
  userId: string;
  lessonVersionId: string;
  challengeVersionId?: string;
  status: SessionStatus;
  startedAt: string;
  lastActivityAt?: string;
  endedAt?: string;
  sandboxStatus?: SandboxStatus;
}

export type SessionStatus =
  | 'provisioning'
  | 'active'
  | 'paused'
  | 'ended'
  | 'expired'
  | 'failed';

export interface SandboxInstance {
  id: string;
  learningSessionId: string;
  status: SandboxStatus;
  expiresAt?: string;
  createdAt: string;
}

export type SandboxStatus =
  | 'requested'
  | 'provisioning'
  | 'ready'
  | 'busy'
  | 'resetting'
  | 'expiring'
  | 'destroyed'
  | 'failed';

export interface QueryExecution {
  id: string;
  learningSessionId: string;
  userId: string;
  sqlText: string;
  status: QueryStatus;
  durationMs?: number;
  rowsReturned?: number;
  rowsScanned?: number;
  resultPreview?: QueryResultPreview;
  errorMessage?: string;
  errorCode?: string;
  submittedAt: string;
}

export type QueryStatus =
  | 'accepted'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'timed_out'
  | 'blocked';

export interface QueryResultPreview {
  columns: string[];
  rows: unknown[][];
  truncated: boolean;
}

export interface QueryExecutionPlan {
  id: string;
  queryExecutionId: string;
  planMode: PlanMode;
  rawPlan: unknown;
  planSummary?: PlanSummary;
  createdAt: string;
}

export type PlanMode = 'explain' | 'explain_analyze';

export interface PlanSummary {
  nodeType: string;
  totalCost?: number;
  actualRows?: number;
  actualTime?: number;
}

export interface ChallengeAttempt {
  id: string;
  learningSessionId: string;
  challengeVersionId: string;
  queryExecutionId: string;
  attemptNo: number;
  status: AttemptStatus;
  score?: number;
  evaluation?: ChallengeEvaluation;
  submittedAt: string;
}

export type AttemptStatus = 'pending' | 'passed' | 'failed' | 'error';

export interface ChallengeEvaluation {
  isCorrect: boolean;
  correctnessScore: number;
  performanceScore?: number;
  feedbackText?: string;
}

// Auth types
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}

// Dataset types
export type DatasetSize = 'tiny' | 'small' | 'medium' | 'large';

export interface DatasetTemplate {
  id: string;
  schemaTemplateId: string;
  name: string;
  size: DatasetSize;
  rowCounts: Record<string, number>;
  status: ContentStatus;
}

export interface SchemaTemplate {
  id: string;
  name: string;
  description?: string;
  version: number;
  tables: SchemaTable[];
  status: ContentStatus;
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
  primaryKey?: string[];
  foreignKeys?: ForeignKey[];
}

export interface SchemaColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue?: string;
  description?: string;
}

export interface ForeignKey {
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
}
