import axios, { type AxiosInstance, type AxiosResponse, type AxiosError } from 'axios';

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
  estimatedHours: number;
  tags: string[];
  thumbnailUrl?: string;
  isPublished: boolean;
  createdAt?: string;
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
  isPublished?: boolean;
  status?: 'locked' | 'available' | 'in_progress' | 'completed';
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
    result: item.result as QueryExecution['result'],
    executionPlan: item.executionPlan as QueryExecution['executionPlan'],
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
      .get<PaginatedResponse<Track>>('/tracks', { params })
      .then((r) => r.data),

  get: (idOrSlug: string) =>
    api.get<Track & { lessons?: Lesson[] }>(`/tracks/${idOrSlug}`).then((r) => r.data),

  /** Convenience: get track then extract its embedded lessons list */
  getLessons: (trackId: string) =>
    api
      .get<Track & { lessons?: Lesson[] }>(`/tracks/${trackId}`)
      .then((r) => r.data.lessons ?? []),

  create: (payload: Partial<Track>) =>
    api.post<Track>('/tracks', payload).then((r) => r.data),

  update: (id: string, payload: Partial<Track>) =>
    api.patch<Track>(`/tracks/${id}`, payload).then((r) => r.data),

  delete: (id: string) => api.delete(`/tracks/${id}`).then((r) => r.data),
};

// ─── Lessons API ──────────────────────────────────────────────────────────────

export const lessonsApi = {
  get: (id: string) => api.get<Lesson>(`/lessons/${id}`).then((r) => r.data),

  create: (payload: Partial<Lesson>) =>
    api.post<Lesson>('/lessons', payload).then((r) => r.data),

  update: (id: string, payload: Partial<Lesson>) =>
    api.patch<Lesson>(`/lessons/${id}`, payload).then((r) => r.data),

  delete: (id: string) => api.delete(`/lessons/${id}`).then((r) => r.data),
};

// ─── Sessions API ─────────────────────────────────────────────────────────────

export const sessionsApi = {
  list: () =>
    api.get<LearningSession[]>('/learning-sessions').then((r) => r.data),

  get: (id: string) =>
    api.get<LearningSession>(`/learning-sessions/${id}`).then((r) => r.data),

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
    api.post<QueryExecution>('/query/execute', payload).then((r) => r.data),

  explain: (payload: QueryExecutionRequest) =>
    api.post<QueryExecution>('/query/explain', payload).then((r) => r.data),

  format: (sql: string) =>
    api.post<{ sql: string }>('/query/format', { sql }).then((r) => r.data),

  history: async (sessionId?: string, params?: { page?: number; limit?: number }) => {
    const pagination = { ...params };

    const primaryPath = sessionId
      ? `/learning-sessions/${sessionId}/query-executions`
      : '/query-executions';
    const legacyPath = '/query/history';

    try {
      const res = await api.get<PaginatedResponse<QueryExecution>>(primaryPath, {
        params: pagination,
      });
      return normalizeQueryHistoryPage(res.data);
    } catch (error) {
      // Backward compatibility for older API servers.
      const res = await api.get<PaginatedResponse<QueryExecution>>(legacyPath, {
        params: { sessionId, ...pagination },
      });
      return normalizeQueryHistoryPage(res.data);
    }
  },
};

// ─── Users API ────────────────────────────────────────────────────────────────

export const usersApi = {
  list: (params?: { search?: string; role?: string; status?: string; page?: number }) =>
    api
      .get<PaginatedResponse<User>>('/users', { params })
      .then((r) => r.data),

  get: (id: string) => api.get<User>(`/users/${id}`).then((r) => r.data),

  updateRole: (id: string, role: string) =>
    api.patch<User>(`/users/${id}/role`, { role }).then((r) => r.data),

  disable: (id: string) => api.post(`/users/${id}/disable`).then((r) => r.data),

  enable: (id: string) => api.post(`/users/${id}/enable`).then((r) => r.data),
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
