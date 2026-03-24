import axios, { type AxiosInstance, type AxiosResponse, type AxiosError } from 'axios';
import { getExplainPlanMode } from './utils';

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

export type UserRole = 'student' | 'contributor' | 'admin';

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
  publishedAt?: string | null;
  createdAt: string;
}

export interface ChallengeEvaluation {
  isCorrect: boolean;
  score?: number;
  correctnessScore?: number;
  performanceScore?: number;
  indexScore?: number;
  feedbackText?: string;
  pointsPossible?: number;
  baselineDurationMs?: number | null;
  latestDurationMs?: number | null;
  usedIndexing?: boolean;
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
  };
}

export interface ChallengeLeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string | null;
  bestScore: number;
  attemptsCount: number;
  passedAttempts: number;
  lastSubmittedAt: string;
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
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  sortOrder: number;
  status: 'draft' | 'published' | 'archived';
  points: number;
  publishedVersionId?: string | null;
  latestVersionId?: string | null;
  latestVersionNo?: number | null;
  validatorType?: string | null;
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

// ─── Sessions ─────────────────────────────────────────────────────────────────

export interface LearningSession {
  id: string;
  userId: string;
  lessonVersionId: string;
  challengeVersionId?: string | null;
  status: 'provisioning' | 'active' | 'paused' | 'ended' | 'expired' | 'failed';
  sandboxStatus?: string | null;
  lessonTitle?: string | null;
  sandbox?: {
    id: string;
    status: string;
    dbName?: string | null;
    expiresAt?: string | null;
    updatedAt?: string | null;
  } | null;
  startedAt: string;
  lastActivityAt?: string | null;
  createdAt: string;
}

// ─── Query Execution ──────────────────────────────────────────────────────────

export interface QueryExecutionRequest {
  sessionId: string;
  sql: string;
  datasetSize?: 'tiny' | 'small' | 'medium' | 'large';
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
  item: Record<string, unknown>,
): QueryExecution['result'] {
  const preview = (
    item.result && typeof item.result === 'object'
      ? item.result
      : item.resultPreview && typeof item.resultPreview === 'object'
        ? item.resultPreview
        : null
  ) as Record<string, unknown> | null;

  if (!preview) {
    return undefined;
  }

  const columns = Array.isArray(preview.columns) ? preview.columns : [];
  const rows = Array.isArray(preview.rows) ? preview.rows : [];

  if (columns.every((column) => typeof column === 'object' && column !== null && 'name' in column)) {
    return {
      columns: columns as QueryResultPreview['columns'],
      rows: rows as QueryResultPreview['rows'],
      totalRows:
        toNumber(preview.totalRows) ??
        toNumber(item.rowCount) ??
        toNumber(item.rowsReturned) ??
        rows.length,
      truncated: Boolean(preview.truncated),
    };
  }

  if (!columns.every((column) => typeof column === 'string')) {
    return undefined;
  }

  const columnNames = columns as string[];
  const normalizedRows = rows.map((row) => {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      return row as Record<string, unknown>;
    }

    if (Array.isArray(row)) {
      return Object.fromEntries(
        columnNames.map((columnName, index) => [columnName, row[index] ?? null]),
      );
    }

    return Object.fromEntries(columnNames.map((columnName) => [columnName, null]));
  });

  return {
    columns: columnNames.map((name) => ({
      name,
      dataType: 'unknown',
      nullable: true,
    })),
    rows: normalizedRows,
    totalRows:
      toNumber(preview.totalRows) ??
      toNumber(item.rowCount) ??
      toNumber(item.rowsReturned) ??
      normalizedRows.length,
    truncated: Boolean(preview.truncated),
  };
}

function normalizeExecutionPlanFromPayload(
  payload: Record<string, unknown>,
): QueryExecution['executionPlan'] {
  const directPlan =
    payload.executionPlan && typeof payload.executionPlan === 'object'
      ? (payload.executionPlan as Record<string, unknown>)
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

  const plans = Array.isArray(payload.plans)
    ? (payload.plans.filter(
        (plan): plan is Record<string, unknown> => typeof plan === 'object' && plan !== null,
      ) as Record<string, unknown>[])
    : [];

  if (plans.length === 0) {
    return undefined;
  }

  const selectedPlan = plans.reduce<Record<string, unknown> | null>((best, current) => {
    const currentMode = current.planMode === 'explain_analyze' ? 2 : current.planMode === 'explain' ? 1 : 0;
    const bestMode = best?.planMode === 'explain_analyze' ? 2 : best?.planMode === 'explain' ? 1 : 0;

    if (currentMode > bestMode) {
      return current;
    }

    if (currentMode < bestMode) {
      return best;
    }

    const currentCreatedAt = Date.parse(String(current.createdAt ?? ''));
    const bestCreatedAt = Date.parse(String(best?.createdAt ?? ''));

    if (Number.isFinite(currentCreatedAt) && (!Number.isFinite(bestCreatedAt) || currentCreatedAt > bestCreatedAt)) {
      return current;
    }

    return best ?? current;
  }, null);

  if (!selectedPlan) {
    return undefined;
  }

  const summary =
    selectedPlan.planSummary && typeof selectedPlan.planSummary === 'object'
      ? (selectedPlan.planSummary as Record<string, unknown>)
      : {};

  return {
    type: 'json',
    plan: selectedPlan.rawPlan,
    totalCost: toNumber(summary.totalCost),
    actualTime: toNumber(summary.actualTime),
    mode:
      selectedPlan.planMode === 'explain' || selectedPlan.planMode === 'explain_analyze'
        ? selectedPlan.planMode
        : undefined,
  };
}

/** Normalize API rows that may use sqlText / learningSessionId / submittedAt. */
function normalizeQueryExecutionItem(item: Record<string, unknown>): QueryExecution {
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
    result: normalizeQueryResultPreview(item),
    executionPlan: normalizeExecutionPlanFromPayload(item),
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
  status: 'pending' | 'running' | 'completed' | 'failed';
  target?: string;
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
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
  schemaTemplateId: string;
  tables: SessionSchemaTable[];
}

// ─── Databases ────────────────────────────────────────────────────────────────

export type DatabaseDomain = 'ecommerce' | 'fintech' | 'health' | 'iot' | 'social' | 'analytics' | 'other';
export type DatabaseScale = 'tiny' | 'small' | 'medium' | 'large' | 'massive';
export type DatabaseDifficulty = 'beginner' | 'intermediate' | 'advanced';

export interface Database {
  id: string;
  name: string;
  slug: string;
  description: string;
  domain: DatabaseDomain;
  scale: DatabaseScale;
  difficulty: DatabaseDifficulty;
  engine: string;
  domainIcon: string;
  tags: string[];
  rowCount: number;
  tableCount: number;
  estimatedSizeGb: number;
  region?: string;
  uptime?: number;
  isAvailable?: boolean;
  schema?: DatabaseTable[];
  relationships?: DatabaseRelationship[];
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
  if (role === 'admin' || role === 'contributor') {
    return role;
  }
  return 'student';
}

function normalizeUser(user: UserPayload): User {
  const roles = user.roles ?? (user.role ? [user.role] : []);
  const primaryRole = roles.includes('admin')
    ? 'admin'
    : roles.includes('contributor')
      ? 'contributor'
      : roles[0];

  return {
    id: user.id,
    username: user.username,
    email: user.email,
    displayName: user.displayName ?? user.username,
    avatarUrl: user.avatarUrl ?? null,
    role: normalizeRole(primaryRole),
    roles,
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
    description: detail.description ?? '',
    points: detail.points ?? 100,
    hintText: detail.hintText ?? null,
    expectedResultColumns: Array.isArray(detail.expectedResultColumns)
      ? detail.expectedResultColumns.filter((value): value is string => typeof value === 'string')
      : [],
  };
}

function normalizeChallengeCatalogItem(item: ChallengeCatalogItem): ChallengeCatalogItem {
  return {
    ...item,
    description: item.description ?? '',
    publishedVersionId: item.publishedVersionId ?? null,
    latestVersionId: item.latestVersionId ?? null,
    latestVersionNo: item.latestVersionNo ?? null,
    validatorType: item.validatorType ?? null,
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

// ─── Axios Instance ───────────────────────────────────────────────────────────

const api: AxiosInstance = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/v1',
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor – attach bearer token
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('sqlcraft-auth');
      if (raw) {
        const parsed = JSON.parse(raw) as { state?: { tokens?: { accessToken?: string } } };
        const token = parsed?.state?.tokens?.accessToken;
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      }
    } catch {
      // ignore parse errors
    }
  }
  return config;
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

    if (axiosError.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('sqlcraft-auth');
      window.location.href = '/login';
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
      .post<{ user: UserPayload; tokens: AuthTokens }>('/auth/login', payload)
      .then((r) => ({
        ...r.data,
        user: normalizeUser(r.data.user),
      }) satisfies AuthResult),

  register: (payload: RegisterPayload) =>
    api
      .post<{ user: UserPayload; tokens: AuthTokens }>('/auth/register', payload)
      .then((r) => ({
        ...r.data,
        user: normalizeUser(r.data.user),
      }) satisfies AuthResult),

  logout: () => api.post('/auth/logout').then((r) => r.data),

  refreshToken: (refreshToken: string) =>
    api.post<AuthTokens>('/auth/refresh', { refreshToken }).then((r) => r.data),

  me: (accessToken?: string) =>
    api
      .get<UserPayload>('/auth/me', {
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

  create: (payload: {
    lessonId: string;
    slug: string;
    title: string;
    description?: string;
    difficulty?: 'beginner' | 'intermediate' | 'advanced';
    sortOrder?: number;
    points?: number;
    problemStatement: string;
    hintText?: string;
    expectedResultColumns?: string[];
    referenceSolution?: string;
    validatorType?: string;
    validatorConfig?: Record<string, unknown>;
  }) => api.post<{ challenge: { id: string }; version: { id: string } }>('/challenges', payload).then((r) => r.data),

  getVersion: (id: string) =>
    api
      .get<ChallengeVersionDetail>(`/challenge-versions/${id}`)
      .then((r) => normalizeChallengeVersionDetail(r.data)),

  submitAttempt: (payload: {
    learningSessionId: string;
    challengeVersionId: string;
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

  listReviewQueue: () =>
    api
      .get<ChallengeReviewItem[]>('/admin/challenges')
      .then((r) => r.data.map(normalizeChallengeReviewItem)),

  publishVersion: (versionId: string) =>
    api.post(`/admin/challenge-versions/${versionId}/publish`).then((r) => r.data),
};

// ─── Sessions API ─────────────────────────────────────────────────────────────

export const sessionsApi = {
  list: () =>
    api.get<LearningSession[]>('/learning-sessions').then((r) => r.data),

  get: (id: string) =>
    api.get<LearningSession>(`/learning-sessions/${id}`).then((r) => r.data),

  getSchema: (id: string) =>
    api.get<SessionSchemaResponse>(`/learning-sessions/${id}/schema`).then((r) => r.data),

  create: (payload: { lessonVersionId: string; challengeVersionId?: string }) =>
    api.post<{ session: LearningSession; sandbox: { id: string; status: string } }>(
      '/learning-sessions',
      payload,
    ).then((r) => r.data.session),

  end: (id: string) =>
    api.post<{ id: string; status: string; endedAt: string | null }>(
      `/learning-sessions/${id}/end`,
    ).then((r) => r.data),
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
  avatarUrl?: string | null;
}

export const usersApi = {
  // Admin-only: list all users
  list: (params?: { search?: string; role?: string; status?: string; page?: number }) =>
    api
      .get<PaginatedResponse<UserPayload & { roles: string[] }>>('/admin/users', { params })
      .then((r) => ({
        ...r.data,
        items: r.data.items.map((u) => normalizeUser(u)),
      })) as Promise<PaginatedResponse<User>>,

  get: (id: string) => api.get<User>(`/users/${id}`).then((r) => r.data),

  // Admin-only: update a user's role
  updateRole: (id: string, role: string) =>
    api.patch<User>(`/admin/users/${id}/role`, { role }).then((r) => r.data),

  // Admin-only: disable a user
  disable: (id: string) =>
    api.patch(`/admin/users/${id}/status`, { status: 'disabled' }).then((r) => r.data),

  // Admin-only: enable a user
  enable: (id: string) =>
    api.patch(`/admin/users/${id}/status`, { status: 'active' }).then((r) => r.data),

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

export const adminApi = {
  metrics: () => api.get<SystemMetrics>('/admin/metrics').then((r) => r.data),

  jobs: () => api.get<SystemJob[]>('/admin/jobs').then((r) => r.data),

  terminateAllSandboxes: () =>
    api.post('/admin/sandboxes/terminate-all').then((r) => r.data),

  triggerMigration: () =>
    api.post('/admin/migrations/run').then((r) => r.data),
};

// ─── Databases API ────────────────────────────────────────────────────────────

export const databasesApi = {
  list: (params?: { domain?: string; scale?: string; difficulty?: string }) =>
    api
      .get<PaginatedResponse<Database>>('/databases', { params })
      .then((r) => r.data),

  get: (id: string) =>
    api.get<Database>(`/databases/${id}`).then((r) => r.data),

  createSession: (databaseId: string, scale?: DatabaseScale) =>
    api
      .post<{ session: LearningSession; sandbox: { id: string; status: string } }>(
        '/databases/sessions',
        { databaseId, scale },
      )
      .then((r) => r.data.session),
};

// ─── Leaderboard API ──────────────────────────────────────────────────────────

export const leaderboardApi = {
  get: (period: 'weekly' | 'monthly' | 'alltime' = 'alltime', limit = 50) =>
    api
      .get<LeaderboardEntry[]>('/leaderboard', { params: { period, limit } })
      .then((r) => r.data),
};

export default api;
