export interface UserStats {
  queriesRun: number;
  completedChallenges: number;
  activeSessions: number;
  totalPoints: number;
  currentStreak: number;
}

export interface UserProfileResponse {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  status: string;
  roles: string[];
  stats: UserStats;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserProfileUpdateResponse {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  bio: string | null;
  status: string;
  updatedAt: Date;
}

export interface SessionSummary {
  id: string;
  lessonVersionId: string | null;
  status: string;
  startedAt: Date;
  lastActivityAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
}

export interface QueryHistoryItem {
  id: string;
  learningSessionId: string;
  sqlText: string;
  status: string;
  durationMs: number | null;
  rowsReturned: number | null;
  errorMessage: string | null;
  submittedAt: Date;
}

export interface PaginatedResult<T> {
  items: T[];
  meta: {
    page: number;
    limit: number;
  };
}
