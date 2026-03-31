import type { SchemaSqlDialect } from '@sqlcraft/types';
import type { DatabaseDomain } from '../../lib/infer-database-domain';

export type { DatabaseDomain } from '../../lib/infer-database-domain';
export type { SchemaSqlDialect } from '@sqlcraft/types';

export type DatabaseScale = 'tiny' | 'small' | 'medium' | 'large' | 'extra_large';
export type DatabaseDifficulty = 'beginner' | 'intermediate' | 'advanced';

/** How a row appears when public + your private / invited DBs are merged (e.g. Explorer, challenge pickers). */
export type DatabaseCatalogKind =
  | 'public'
  | 'private_owner'
  | 'private_invited'
  /** Your public upload awaiting admin approval (draft + pending review). */
  | 'public_pending_owner';

/** Source dataset golden snapshot pipeline (catalog end-user visibility uses `ready` + published). */
export type SandboxGoldenStatus = 'none' | 'pending' | 'ready' | 'failed';

export interface DatabaseColumn {
  name: string;
  type: string;
  isPrimary?: boolean;
  isForeign?: boolean;
  isNullable?: boolean;
  references?: string;
}

export interface DatabaseTable {
  name: string;
  role?: 'primary' | 'secondary' | 'junction';
  columns: DatabaseColumn[];
}

export interface DatabaseRelationship {
  from: string;
  to: string;
  label?: string;
}

export interface DatabaseItem {
  id: string;
  name: string;
  slug: string;
  description: string;
  domain: DatabaseDomain;
  scale: DatabaseScale;
  sourceScale: DatabaseScale;
  difficulty: DatabaseDifficulty;
  /** Stored template target engine (from import or admin). */
  dialect: SchemaSqlDialect;
  /** Parsed dump / admin override; drives sandbox image major where applicable. */
  engineVersion: string | null;
  engine: string;
  domainIcon: string;
  tags: string[];
  rowCount: number;
  sourceRowCount: number;
  tableCount: number;
  estimatedSizeGb: number;
  schemaTemplateId: string;
  /** Set for authenticated list/detail when your private or invited templates are included. */
  catalogKind: DatabaseCatalogKind;
  availableScales: DatabaseScale[];
  availableScaleMetadata: Array<{ scale: DatabaseScale; rowCount: number }>;
  /** From source-scale dataset template; drives admin golden-bake chips. */
  sandboxGoldenStatus: SandboxGoldenStatus;
  /** When `sandboxGoldenStatus === 'failed'`, contains the golden-bake error details (best-effort). */
  sandboxGoldenError: string | null;
  schema?: DatabaseTable[];
  relationships?: DatabaseRelationship[];
}

export interface PaginatedDatabasesResult {
  items: DatabaseItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CreateDatabaseSessionResult {
  session: {
    id: string;
    userId: string;
    challengeVersionId: string | null;
    status: string;
    startedAt: Date;
    createdAt: Date;
    databaseName: string;
    sourceScale: DatabaseScale;
    selectedScale: DatabaseScale;
    availableScales: DatabaseScale[];
    rowCount: number;
    sourceRowCount: number;
  };
  sandbox: {
    id: string;
    status: string;
  };
}
