import type { SandboxRow } from '../../db/repositories';

export interface GetSandboxResult {
  id: string;
  learningSessionId: string;
  status: SandboxRow['status'];
  dbName: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ResetSandboxResult {
  sandboxId: string;
  status: 'resetting';
  requestedAt: Date;
}
