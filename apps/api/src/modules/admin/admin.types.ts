import type { TrackRow, LessonRow, LessonVersionRow, ChallengeRow, ChallengeVersionRow, UserRow } from '../../db/repositories';

export interface CreateTrackResult extends TrackRow {}

export interface UpdateTrackResult extends TrackRow {}

export interface CreateLessonResult extends LessonRow {}

export interface CreateLessonVersionResult extends LessonVersionRow {}

export interface PublishLessonVersionResult extends LessonVersionRow {}

export interface CreateChallengeResult {
  challenge: ChallengeRow;
  version: ChallengeVersionRow;
}

export interface PublishChallengeVersionResult extends ChallengeVersionRow {}

export interface ListUsersResult {
  items: (Pick<UserRow, 'id' | 'email' | 'username' | 'displayName' | 'status' | 'provider' | 'lastLoginAt' | 'createdAt'> & { roles: string[] })[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface UpdateUserRoleResult {
  id: string;
  email: string;
  username: string | null;
  roles: string[];
  updatedAt: Date | null;
}

export interface UpdateUserStatusResult {
  id: string;
  email: string;
  username: string | null;
  status: UserRow['status'];
  updatedAt: Date | null;
}

export interface SystemHealthResult {
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
