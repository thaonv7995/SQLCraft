export type DatabaseDomain =
  | 'ecommerce'
  | 'fintech'
  | 'health'
  | 'iot'
  | 'social'
  | 'analytics'
  | 'other';

export type DatabaseScale = 'tiny' | 'small' | 'medium' | 'large' | 'massive';
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
  difficulty: DatabaseDifficulty;
  engine: string;
  domainIcon: string;
  tags: string[];
  rowCount: number;
  tableCount: number;
  estimatedSizeGb: number;
  schemaTemplateId: string;
  availableScales: DatabaseScale[];
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
    lessonVersionId: string;
    challengeVersionId: string | null;
    status: string;
    startedAt: Date;
    createdAt: Date;
  };
  sandbox: {
    id: string;
    status: string;
  };
}
