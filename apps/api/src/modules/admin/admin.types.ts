import type { DatasetSize } from '@sqlcraft/types';
import type {
  TrackRow,
  LessonRow,
  LessonVersionRow,
  LessonVersionSummaryRow,
  ChallengeRow,
  ChallengeVersionRow,
  UserRow,
} from '../../db/repositories';
import type {
  AdminConfigRow as AdminConfigRecordRow,
  SchemaTemplateRow as AdminSchemaTemplateRow,
  DatasetTemplateRow as AdminDatasetTemplateRow,
  SystemJobRow as AdminSystemJobRow,
} from '../../db/repositories/admin.repository';
import type {
  AdminDatabaseDomain,
  SqlDumpScanResult as AdminSqlDumpScanResult,
} from './sql-dump-scan';
import type { AdminConfigBody } from './admin.schema';

export interface CreateTrackResult extends TrackRow {}

export interface UpdateTrackResult extends TrackRow {}

export interface CreateLessonResult extends LessonRow {}

export interface CreateLessonVersionResult extends LessonVersionRow {}

export interface PublishLessonVersionResult extends LessonVersionRow {}

export interface LessonVersionSummaryResult extends LessonVersionSummaryRow {}

export interface LessonVersionAdminDetailResult extends LessonVersionRow {}

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

export interface AdminConfigResult extends Omit<AdminConfigRecordRow, 'config'> {
  config: AdminConfigBody;
}

export type SqlDumpScanResult = AdminSqlDumpScanResult;
export type AdminDatabaseDomainType = AdminDatabaseDomain;

export interface ImportCanonicalDatabaseResult {
  schemaTemplate: AdminSchemaTemplateRow;
  sourceDatasetTemplate: AdminDatasetTemplateRow;
  derivedDatasetTemplates: AdminDatasetTemplateRow[];
  sourceScale: DatasetSize;
  sourceTotalRows: number;
  jobs: {
    importJob: AdminSystemJobRow;
    datasetGenerationJob: AdminSystemJobRow | null;
  };
}

export interface ListSystemJobsResult {
  items: AdminSystemJobRow[];
}
