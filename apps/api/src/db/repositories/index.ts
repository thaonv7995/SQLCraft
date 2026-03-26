import { UsersRepository } from './users.repository';
import { SessionsRepository } from './sessions.repository';
import { QueriesRepository } from './queries.repository';
import { ChallengesRepository } from './challenges.repository';
import { SandboxesRepository } from './sandboxes.repository';
import { AdminRepository } from './admin.repository';

// ─── Singleton instances ───────────────────────────────────────────────────────
export const usersRepository = new UsersRepository();
export const sessionsRepository = new SessionsRepository();
export const queriesRepository = new QueriesRepository();
export const challengesRepository = new ChallengesRepository();
export const sandboxesRepository = new SandboxesRepository();
export const adminRepository = new AdminRepository();

// ─── Classes ──────────────────────────────────────────────────────────────────
export {
  UsersRepository,
  SessionsRepository,
  QueriesRepository,
  ChallengesRepository,
  SandboxesRepository,
  AdminRepository,
};

// ─── Types: Users ─────────────────────────────────────────────────────────────
export type { UserRow, RefreshTokenRow } from './users.repository';

// ─── Types: Sessions ──────────────────────────────────────────────────────────
// SessionRow, SandboxRow canonical source
export type { SessionRow, SandboxRow } from './sessions.repository';

// ─── Types: Queries ───────────────────────────────────────────────────────────
export type { QueryExecutionRow, QueryExecutionPlanRow } from './queries.repository';

// ─── Types: Challenges ────────────────────────────────────────────────────────
export type {
  ChallengeRow,
  ChallengeVersionRow,
  ChallengeAttemptRow,
  ChallengeAttemptWithExecutionRow,
  ChallengeLeaderboardAttemptRow,
  GlobalLeaderboardAttemptRow,
  ChallengeCatalogRow,
  EditableChallengeDetailRow,
  PublishedChallengeVersionRow,
  PublishedChallengeVersionDetailRow,
  ReviewChallengeRow,
  SessionExecutionSummaryRow,
  SessionSubmissionContextRow,
} from './challenges.repository';

// ─── Types: Admin ─────────────────────────────────────────────────────────────
export type { SystemHealthStats, AdminConfigRow } from './admin.repository';
