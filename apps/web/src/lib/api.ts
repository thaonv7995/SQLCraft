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

export interface User {
  id: string;
  username: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  role: 'student' | 'contributor' | 'admin';
  createdAt: string;
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
  order: number;
  isPublished: boolean;
  status?: 'locked' | 'available' | 'in_progress' | 'completed';
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export interface LearningSession {
  id: string;
  userId: string;
  lessonId?: string;
  trackId?: string;
  status: 'provisioning' | 'ready' | 'active' | 'idle' | 'terminated' | 'error';
  datasetSize: 'tiny' | 'small' | 'medium' | 'large';
  sandboxConnectionString?: string;
  createdAt: string;
  lastActivityAt: string;
  expiresAt?: string;
  lesson?: Lesson;
  track?: Track;
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

    return Promise.reject(new Error(message));
  }
);

// ─── Auth API ─────────────────────────────────────────────────────────────────

export const authApi = {
  login: (payload: LoginPayload) =>
    api.post<AuthTokens>('/auth/login', payload).then((r) => r.data),

  register: (payload: RegisterPayload) =>
    api.post<{ user: User; tokens: AuthTokens }>('/auth/register', payload).then((r) => r.data),

  logout: () => api.post('/auth/logout').then((r) => r.data),

  refreshToken: (refreshToken: string) =>
    api.post<AuthTokens>('/auth/refresh', { refreshToken }).then((r) => r.data),

  me: () => api.get<User>('/auth/me').then((r) => r.data),
};

// ─── Tracks API ───────────────────────────────────────────────────────────────

export const tracksApi = {
  list: (params?: { difficulty?: string; page?: number; limit?: number }) =>
    api
      .get<PaginatedResponse<Track>>('/tracks', { params })
      .then((r) => r.data),

  get: (idOrSlug: string) =>
    api.get<Track>(`/tracks/${idOrSlug}`).then((r) => r.data),

  getLessons: (trackId: string) =>
    api.get<Lesson[]>(`/tracks/${trackId}/lessons`).then((r) => r.data),

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
  list: () => api.get<LearningSession[]>('/sessions').then((r) => r.data),

  get: (id: string) =>
    api.get<LearningSession>(`/sessions/${id}`).then((r) => r.data),

  create: (payload: { lessonId?: string; trackId?: string; datasetSize?: string }) =>
    api.post<LearningSession>('/sessions', payload).then((r) => r.data),

  terminate: (id: string) =>
    api.post<LearningSession>(`/sessions/${id}/terminate`).then((r) => r.data),

  pollStatus: (id: string) =>
    api.get<LearningSession>(`/sessions/${id}/status`).then((r) => r.data),
};

// ─── Query Execution API ──────────────────────────────────────────────────────

export const queryApi = {
  execute: (payload: QueryExecutionRequest) =>
    api.post<QueryExecution>('/query/execute', payload).then((r) => r.data),

  explain: (payload: QueryExecutionRequest) =>
    api.post<QueryExecution>('/query/explain', payload).then((r) => r.data),

  format: (sql: string) =>
    api.post<{ sql: string }>('/query/format', { sql }).then((r) => r.data),

  history: (sessionId?: string, params?: { page?: number; limit?: number }) =>
    api
      .get<PaginatedResponse<QueryExecution>>('/query/history', {
        params: { sessionId, ...params },
      })
      .then((r) => r.data),
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

// ─── Leaderboard API ──────────────────────────────────────────────────────────

export const leaderboardApi = {
  get: (period: 'weekly' | 'monthly' | 'alltime' = 'alltime', limit = 50) =>
    api
      .get<LeaderboardEntry[]>('/leaderboard', { params: { period, limit } })
      .then((r) => r.data),
};

export default api;
