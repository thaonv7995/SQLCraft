import type { DatabaseDomain } from '../../lib/infer-database-domain';

export type { DatabaseDomain } from '../../lib/infer-database-domain';

export type DatabaseScale = 'tiny' | 'small' | 'medium' | 'large';
export type DatabaseDifficulty = 'beginner' | 'intermediate' | 'advanced';

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
  engine: string;
  domainIcon: string;
  tags: string[];
  rowCount: number;
  sourceRowCount: number;
  tableCount: number;
  estimatedSizeGb: number;
  schemaTemplateId: string;
  availableScales: DatabaseScale[];
  availableScaleMetadata: Array<{ scale: DatabaseScale; rowCount: number }>;
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
