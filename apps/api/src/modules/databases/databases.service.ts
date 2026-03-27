import { and, asc, desc, eq } from 'drizzle-orm';
import { getDb, schema as dbSchema } from '../../db';
import { sessionsRepository } from '../../db/repositories';
import { NotFoundError, ValidationError } from '../../lib/errors';
import { enqueueProvisionSandbox } from '../../lib/queue';
import type {
  CreateDatabaseSessionBody,
  ListDatabasesQuery,
} from './databases.schema';
import type {
  CreateDatabaseSessionResult,
  DatabaseColumn,
  DatabaseDifficulty,
  DatabaseDomain,
  DatabaseItem,
  DatabaseRelationship,
  DatabaseScale,
  DatabaseTable,
  PaginatedDatabasesResult,
} from './databases.types';

interface SchemaColumnDefinition {
  name: string;
  type: string;
}

interface SchemaTableDefinition {
  name: string;
  columns: SchemaColumnDefinition[];
}

interface SchemaDefinition {
  tables?: SchemaTableDefinition[];
}

type SchemaTemplateRow = typeof dbSchema.schemaTemplates.$inferSelect;
type DatasetTemplateRow = typeof dbSchema.datasetTemplates.$inferSelect;

const DOMAIN_ICONS: Record<DatabaseDomain, string> = {
  ecommerce: 'storefront',
  fintech: 'account_balance',
  health: 'health_and_safety',
  iot: 'sensors',
  social: 'groups',
  analytics: 'monitoring',
  other: 'database',
};

const SCALE_ORDER: DatabaseScale[] = ['tiny', 'small', 'medium', 'large'];
const SCALE_RANK: Record<DatabaseScale, number> = {
  tiny: 0,
  small: 1,
  medium: 2,
  large: 3,
};

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function inferDomain(name: string, description: string): DatabaseDomain {
  const haystack = `${name} ${description}`.toLowerCase();
  if (/(ecommerce|commerce|retail|order|product|inventory)/.test(haystack)) return 'ecommerce';
  if (/(fintech|ledger|payment|merchant|bank|fraud|compliance)/.test(haystack)) return 'fintech';
  if (/(health|patient|ehr|clinical|fhir|prescription)/.test(haystack)) return 'health';
  if (/(iot|sensor|telemetry|device)/.test(haystack)) return 'iot';
  if (/(social|community|post|comment|feed)/.test(haystack)) return 'social';
  if (/(analytics|event|warehouse|report|insight)/.test(haystack)) return 'analytics';
  return 'other';
}

function inferDifficulty(tableCount: number): DatabaseDifficulty {
  if (tableCount >= 8) return 'advanced';
  if (tableCount >= 5) return 'intermediate';
  return 'beginner';
}

function parseSchemaDefinition(definition: unknown): SchemaDefinition {
  if (!definition || typeof definition !== 'object') {
    return { tables: [] };
  }

  const maybeTables = (definition as SchemaDefinition).tables;
  if (!Array.isArray(maybeTables)) {
    return { tables: [] };
  }

  return {
    tables: maybeTables
      .filter((table): table is SchemaTableDefinition => {
        return (
          !!table &&
          typeof table === 'object' &&
          typeof table.name === 'string' &&
          Array.isArray(table.columns)
        );
      })
      .map((table) => ({
        name: table.name,
        columns: table.columns
          .filter((column): column is SchemaColumnDefinition => {
            return !!column && typeof column === 'object' && typeof column.name === 'string' && typeof column.type === 'string';
          })
          .map((column) => ({ name: column.name, type: column.type })),
      })),
  };
}

function extractReference(type: string): string | undefined {
  const match = type.match(/references\s+([a-z_]+)\(([^)]+)\)/i);
  if (!match) {
    return undefined;
  }
  return `${match[1]}.${match[2]}`;
}

function normalizeColumn(column: SchemaColumnDefinition): DatabaseColumn {
  const upper = column.type.toUpperCase();
  const references = extractReference(column.type);

  return {
    name: column.name,
    type: column.type.replace(/\s+references\s+[a-z_]+\([^)]+\)/i, '').trim(),
    isPrimary: upper.includes('PRIMARY KEY'),
    isForeign: !!references,
    isNullable: !upper.includes('NOT NULL') && !upper.includes('PRIMARY KEY'),
    references,
  };
}

function inferTableRole(table: SchemaTableDefinition): DatabaseTable['role'] {
  const foreignKeyCount = table.columns.filter((column) => /references/i.test(column.type)).length;
  if (foreignKeyCount >= 2 || /_items$|_map$|_join$/i.test(table.name)) {
    return 'junction';
  }
  if (foreignKeyCount === 0) {
    return 'primary';
  }
  return 'secondary';
}

function buildRelationships(tables: SchemaTableDefinition[]): DatabaseRelationship[] {
  return tables.flatMap((table) =>
    table.columns.flatMap((column) => {
      const reference = extractReference(column.type);
      if (!reference) {
        return [];
      }

      const [toTable] = reference.split('.');
      return [{ from: table.name, to: toTable, label: 'n:1' }];
    }),
  );
}

function estimateSizeGb(rowCount: number, tableCount: number): number {
  if (rowCount <= 0) return 0;
  const estimated = (rowCount * Math.max(tableCount, 1) * 180) / 1_000_000_000;
  return Number(estimated.toFixed(1));
}

function sumRowCounts(rowCounts: unknown): number {
  if (!rowCounts || typeof rowCounts !== 'object') {
    return 0;
  }

  return Object.values(rowCounts as Record<string, unknown>).reduce<number>((total, value) => {
    if (typeof value === 'number') {
      return total + value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? total + parsed : total;
    }
    return total;
  }, 0);
}

function rowCountForDataset(datasetTemplate: DatasetTemplateRow | null): number {
  return datasetTemplate ? sumRowCounts(datasetTemplate.rowCounts) : 0;
}

function uniqueSortedScales(scales: DatabaseScale[]): DatabaseScale[] {
  return Array.from(new Set(scales))
    .filter((scale): scale is DatabaseScale => SCALE_ORDER.includes(scale))
    .sort((a, b) => SCALE_RANK[b] - SCALE_RANK[a]);
}

function chooseSourceScale(availableScales: DatabaseScale[]): DatabaseScale {
  return uniqueSortedScales(availableScales)[0] ?? 'small';
}

function isUpscale(requestedScale: DatabaseScale, sourceScale: DatabaseScale): boolean {
  return SCALE_RANK[requestedScale] > SCALE_RANK[sourceScale];
}

function buildTags(domain: DatabaseDomain, tables: SchemaTableDefinition[]): string[] {
  const domainTags: Record<DatabaseDomain, string[]> = {
    ecommerce: ['Orders', 'Inventory', 'Analytics'],
    fintech: ['Ledger', 'Fraud', 'Compliance'],
    health: ['Patients', 'Encounters', 'FHIR'],
    iot: ['Devices', 'Telemetry', 'Streams'],
    social: ['Users', 'Feed', 'Engagement'],
    analytics: ['Events', 'Warehouse', 'KPIs'],
    other: [],
  };

  const fallback = tables.slice(0, 3).map((table) =>
    table.name
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase()),
  );

  return (domainTags[domain].length > 0 ? domainTags[domain] : fallback).slice(0, 3);
}

function buildDatabaseItem(
  schemaTemplate: SchemaTemplateRow,
  datasetTemplates: DatasetTemplateRow[],
): DatabaseItem {
  const definition = parseSchemaDefinition(schemaTemplate.definition);
  const tables = definition.tables ?? [];
  const availableScales = uniqueSortedScales(
    datasetTemplates.map((dataset) => dataset.size as DatabaseScale),
  );
  const sourceScale = chooseSourceScale(availableScales);
  const sourceDataset = datasetTemplates.find((dataset) => dataset.size === sourceScale);
  const sourceRowCount = sourceDataset ? sumRowCounts(sourceDataset.rowCounts) : 0;
  const description = schemaTemplate.description ?? `${schemaTemplate.name} training database`;
  const domain = inferDomain(schemaTemplate.name, description);

  return {
    id: schemaTemplate.id,
    name: schemaTemplate.name,
    slug: slugify(schemaTemplate.name),
    description,
    domain,
    scale: sourceScale,
    sourceScale,
    difficulty: inferDifficulty(tables.length),
    engine: 'PostgreSQL 16',
    domainIcon: DOMAIN_ICONS[domain],
    tags: buildTags(domain, tables),
    rowCount: sourceRowCount,
    sourceRowCount,
    tableCount: tables.length,
    estimatedSizeGb: estimateSizeGb(sourceRowCount, tables.length),
    schemaTemplateId: schemaTemplate.id,
    availableScales,
    availableScaleMetadata: availableScales.map((scale) => {
      const dataset = datasetTemplates.find((row) => row.size === scale);
      return {
        scale,
        rowCount: dataset ? sumRowCounts(dataset.rowCounts) : 0,
      };
    }),
    schema: tables.map((table) => ({
      name: table.name,
      role: inferTableRole(table),
      columns: table.columns.map(normalizeColumn),
    })),
    relationships: buildRelationships(tables),
  };
}

async function loadDatabaseCatalog(): Promise<DatabaseItem[]> {
  const db = getDb();

  const [schemaTemplates, datasetTemplates] = await Promise.all([
    db
      .select()
      .from(dbSchema.schemaTemplates)
      .where(eq(dbSchema.schemaTemplates.status, 'published'))
      .orderBy(asc(dbSchema.schemaTemplates.name)),
    db
      .select()
      .from(dbSchema.datasetTemplates)
      .where(eq(dbSchema.datasetTemplates.status, 'published'))
      .orderBy(desc(dbSchema.datasetTemplates.createdAt)),
  ]);

  const datasetsBySchema = datasetTemplates.reduce<Record<string, Record<string, DatasetTemplateRow>>>(
    (acc, dataset) => {
      const bucket = acc[dataset.schemaTemplateId] ?? {};
      if (!bucket[dataset.size]) {
        bucket[dataset.size] = dataset;
      }
      acc[dataset.schemaTemplateId] = bucket;
      return acc;
    },
    {},
  );

  return schemaTemplates.map((template) =>
    buildDatabaseItem(template, Object.values(datasetsBySchema[template.id] ?? {})),
  );
}

async function findDatasetForSchema(
  schemaTemplateId: string,
  requestedScale: DatabaseScale,
): Promise<DatasetTemplateRow | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(dbSchema.datasetTemplates)
    .where(
      and(
        eq(dbSchema.datasetTemplates.schemaTemplateId, schemaTemplateId),
        eq(dbSchema.datasetTemplates.size, requestedScale),
        eq(dbSchema.datasetTemplates.status, 'published'),
      ),
    )
    .orderBy(desc(dbSchema.datasetTemplates.createdAt))
    .limit(1);
  return row ?? null;
}

export async function listDatabases(
  query: ListDatabasesQuery,
): Promise<PaginatedDatabasesResult> {
  const catalog = await loadDatabaseCatalog();
  const filtered = catalog.filter((database) => {
    if (query.domain && database.domain !== query.domain) return false;
    if (query.difficulty && database.difficulty !== query.difficulty) return false;
    if (query.scale && !database.availableScales.includes(query.scale)) return false;
    return true;
  });

  const offset = (query.page - 1) * query.limit;
  const items = filtered.slice(offset, offset + query.limit);

  return {
    items,
    total: filtered.length,
    page: query.page,
    limit: query.limit,
    totalPages: Math.max(1, Math.ceil(filtered.length / query.limit)),
  };
}

export async function getDatabase(databaseId: string): Promise<DatabaseItem> {
  const catalog = await loadDatabaseCatalog();
  const database = catalog.find((item) => item.id === databaseId || item.slug === databaseId);

  if (!database) {
    throw new NotFoundError('Database not found');
  }

  return database;
}

export async function createDatabaseSession(
  userId: string,
  body: CreateDatabaseSessionBody,
): Promise<CreateDatabaseSessionResult> {
  const database = await getDatabase(body.databaseId);
  const sourceScale = database.sourceScale ?? database.scale;
  const requestedScale = body.scale ?? sourceScale;

  if (isUpscale(requestedScale, sourceScale)) {
    throw new ValidationError(
      `Requested scale "${requestedScale}" is larger than source scale "${sourceScale}"`,
      {
        sourceScale,
        requestedScale,
        availableScales: database.availableScales,
      },
    );
  }

  if (!database.availableScales.includes(requestedScale)) {
    throw new ValidationError(
      `Scale "${requestedScale}" is unavailable for this database`,
      {
        sourceScale,
        requestedScale,
        availableScales: database.availableScales,
      },
    );
  }

  const datasetTemplate = await findDatasetForSchema(database.schemaTemplateId, requestedScale);
  if (!datasetTemplate) {
    throw new ValidationError(
      `Dataset template for scale "${requestedScale}" is unavailable`,
      {
        sourceScale,
        requestedScale,
        availableScales: database.availableScales,
      },
    );
  }

  const session = await sessionsRepository.createSession({
    userId,
    challengeVersionId: null,
    status: 'provisioning',
  });

  const sandbox = await sessionsRepository.createSandbox({
    learningSessionId: session.id,
    schemaTemplateId: database.schemaTemplateId,
    datasetTemplateId: datasetTemplate.id,
    status: 'requested',
  });

  await enqueueProvisionSandbox({
    sandboxInstanceId: sandbox.id,
    learningSessionId: session.id,
    schemaTemplateId: database.schemaTemplateId,
    datasetTemplateId: datasetTemplate.id,
  });

  return {
    session: {
      id: session.id,
      userId: session.userId,
      challengeVersionId: session.challengeVersionId,
      status: session.status,
      startedAt: session.startedAt,
      createdAt: session.createdAt,
      databaseName: database.name,
      sourceScale,
      selectedScale: requestedScale,
      availableScales: database.availableScales,
      rowCount: rowCountForDataset(datasetTemplate),
      sourceRowCount: database.sourceRowCount,
    },
    sandbox: {
      id: sandbox.id,
      status: sandbox.status,
    },
  };
}
