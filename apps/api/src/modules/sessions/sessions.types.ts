import type { SessionRow, SandboxRow } from '../../db/repositories';

export interface CreateSessionResult {
  session: Pick<
    SessionRow,
    'id' | 'userId' | 'lessonVersionId' | 'challengeVersionId' | 'status' | 'startedAt' | 'createdAt'
  >;
  sandbox: Pick<SandboxRow, 'id' | 'status'>;
}

export interface GetSessionResult extends SessionRow {
  sandbox: Pick<SandboxRow, 'id' | 'status' | 'dbName' | 'expiresAt' | 'updatedAt'> | null;
}

export interface EndSessionResult {
  id: string;
  status: SessionRow['status'];
  endedAt: Date | null;
}
