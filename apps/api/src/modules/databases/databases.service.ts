import type { SchemaSqlDialect } from '@sqlcraft/types';
import { normalizeSchemaSqlEngine } from '@sqlcraft/types';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { getDb, schema as dbSchema } from '../../db';
import { sessionsRepository } from '../../db/repositories';
import { ForbiddenError, NotFoundError, ValidationError } from '../../lib/errors';
import { inferDatabaseDomain } from '../../lib/infer-database-domain';
import { enqueueProvisionSandbox } from '../../lib/queue';
import { databaseMatchesListQuery } from './databases.filters';
import type {
  CreateDatabaseSessionBody,
  ListDatabasesQuery,
} from './databases.schema';
import type {
  CreateDatabaseSessionResult,
  DatabaseColumn,
  DatabaseDifficulty,
  DatabaseDomain,
  DatabaseCatalogKind,
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

function dialectToEngineLabel(dialect: string, engineVersion: string | null): string {
  const family = normalizeSchemaSqlEngine(dialect);
  switch (family) {
    case 'mysql':
      return engineVersion ? `MySQL ${engineVersion}` : 'MySQL';
    case 'mariadb':
      return engineVersion ? `MariaDB ${engineVersion}` : 'MariaDB';
    case 'sqlite':
      return engineVersion ? `SQLite ${engineVersion}` : 'SQLite';
    case 'sqlserver':
      return engineVersion ? `SQL Server ${engineVersion}` : 'SQL Server';
    default:
      return engineVersion ? `PostgreSQL ${engineVersion}` : 'PostgreSQL';
  }
}

function normalizeSchemaDialect(dialect: string | null | undefined): SchemaSqlDialect {
  return normalizeSchemaSqlEngine(dialect);
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
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

/**
 * Catalog-only size hint from row counts — not dump file bytes or live engine footprint.
 * Previous formula incorrectly multiplied by table count (as if every row existed in every table).
 * ~100–120 B/row matches typical compressed SQL text scale for OLTP dumps.
 */
function estimateSizeGb(rowCount: number, _tableCount: number): number {
  if (rowCount <= 0) return 0;
  const bytesPerRow = 110;
  const estimated = (rowCount * bytesPerRow) / 1_000_000_000;
  // Keep fractional GB for the API; UI picks MB vs GB. Rounding to 1 decimal here turned tiny DBs into 0.0.
  return estimated;
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
  catalogKind: DatabaseCatalogKind = 'public',
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
  const domain = inferDatabaseDomain(schemaTemplate.name, description);

  const dialect = normalizeSchemaDialect(schemaTemplate.dialect);

  return {
    id: schemaTemplate.catalogAnchorId,
    name: schemaTemplate.name,
    slug: slugify(schemaTemplate.name),
    description,
    domain,
    scale: sourceScale,
    sourceScale,
    difficulty: inferDifficulty(tables.length),
    dialect,
    engineVersion: schemaTemplate.engineVersion ?? null,
    engine: dialectToEngineLabel(dialect, schemaTemplate.engineVersion ?? null),
    domainIcon: DOMAIN_ICONS[domain],
    tags: buildTags(domain, tables),
    rowCount: sourceRowCount,
    sourceRowCount,
    tableCount: tables.length,
    estimatedSizeGb: estimateSizeGb(sourceRowCount, tables.length),
    schemaTemplateId: schemaTemplate.id,
    catalogKind,
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

async function findSchemaTemplateHeadRow(
  databaseId: string,
): Promise<SchemaTemplateRow | null> {
  const db = getDb();
  const [direct] = await db
    .select()
    .from(dbSchema.schemaTemplates)
    .where(eq(dbSchema.schemaTemplates.id, databaseId))
    .limit(1);
  if (!direct) {
    return null;
  }
  const anchor = direct.catalogAnchorId;
  const [head] = await db
    .select()
    .from(dbSchema.schemaTemplates)
    .where(
      and(
        eq(dbSchema.schemaTemplates.catalogAnchorId, anchor),
        isNull(dbSchema.schemaTemplates.replacedById),
      ),
    )
    .limit(1);
  if (head) {
    return head;
  }
  return direct.replacedById ? null : direct;
}

/** Ensures the schema template exists, is published, and the user may build challenges on it. */
export async function assertSchemaTemplateUsableForUserChallenge(
  userId: string,
  databaseId: string,
  opts: { isAdmin?: boolean } = {},
): Promise<void> {
  const head = await findSchemaTemplateHeadRow(databaseId);
  if (!head) {
    throw new NotFoundError('Database not found');
  }

  if (opts.isAdmin) {
    if (head.status !== 'published') {
      throw new ValidationError('Database is not published.');
    }
    return;
  }

  if (head.status !== 'published') {
    throw new ValidationError('Database is not published or is still awaiting review.');
  }

  if (head.visibility === 'public') {
    if (head.reviewStatus !== 'approved') {
      throw new ValidationError('This public database is not approved for use yet.');
    }
    return;
  }

  if (head.createdBy === userId) {
    return;
  }

  const db = getDb();
  const [inv] = await db
    .select({ id: dbSchema.schemaTemplateInvites.id })
    .from(dbSchema.schemaTemplateInvites)
    .where(
      and(
        eq(dbSchema.schemaTemplateInvites.schemaTemplateId, head.id),
        eq(dbSchema.schemaTemplateInvites.userId, userId),
      ),
    )
    .limit(1);

  if (!inv) {
    throw new ForbiddenError('You do not have access to this private database.');
  }
}

async function loadDatabaseCatalog(): Promise<DatabaseItem[]> {
  const db = getDb();

  const [schemaTemplates, datasetTemplates] = await Promise.all([
    db
      .select()
      .from(dbSchema.schemaTemplates)
      .where(
        and(
          eq(dbSchema.schemaTemplates.status, 'published'),
          isNull(dbSchema.schemaTemplates.replacedById),
          eq(dbSchema.schemaTemplates.visibility, 'public'),
          eq(dbSchema.schemaTemplates.reviewStatus, 'approved'),
        ),
      )
      .orderBy(
        desc(dbSchema.schemaTemplates.createdAt),
        desc(dbSchema.schemaTemplates.name),
      ),
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
    buildDatabaseItem(template, Object.values(datasetsBySchema[template.id] ?? {}), 'public'),
  );
}

/** Published public catalog plus private templates you own or are invited to (same IDs as Explorer when logged in). */
async function loadViewerAccessibleCatalog(viewerUserId: string): Promise<DatabaseItem[]> {
  const publicItems = await loadDatabaseCatalog();
  const db = getDb();
  const inviteRows = await db
    .select({ sid: dbSchema.schemaTemplateInvites.schemaTemplateId })
    .from(dbSchema.schemaTemplateInvites)
    .where(eq(dbSchema.schemaTemplateInvites.userId, viewerUserId));
  const inviteIds = [...new Set(inviteRows.map((r) => r.sid))];

  const accessCond =
    inviteIds.length > 0
      ? or(
          eq(dbSchema.schemaTemplates.createdBy, viewerUserId),
          inArray(dbSchema.schemaTemplates.id, inviteIds),
        )
      : eq(dbSchema.schemaTemplates.createdBy, viewerUserId);

  const privateTemplates = await db
    .select()
    .from(dbSchema.schemaTemplates)
    .where(
      and(
        eq(dbSchema.schemaTemplates.status, 'published'),
        isNull(dbSchema.schemaTemplates.replacedById),
        eq(dbSchema.schemaTemplates.visibility, 'private'),
        accessCond,
      ),
    );

  const privateIds = privateTemplates.map((t) => t.id);
  const privateDatasets =
    privateIds.length > 0
      ? await db
          .select()
          .from(dbSchema.datasetTemplates)
          .where(
            and(
              inArray(dbSchema.datasetTemplates.schemaTemplateId, privateIds),
              eq(dbSchema.datasetTemplates.status, 'published'),
            ),
          )
          .orderBy(desc(dbSchema.datasetTemplates.createdAt))
      : [];

  const privateDatasetsBySchema = privateDatasets.reduce<
    Record<string, Record<string, DatasetTemplateRow>>
  >((acc, dataset) => {
    const bucket = acc[dataset.schemaTemplateId] ?? {};
    if (!bucket[dataset.size]) {
      bucket[dataset.size] = dataset;
    }
    acc[dataset.schemaTemplateId] = bucket;
    return acc;
  }, {});

  const privateItems = privateTemplates.map((template) =>
    buildDatabaseItem(
      template,
      Object.values(privateDatasetsBySchema[template.id] ?? {}),
      template.createdBy === viewerUserId ? 'private_owner' : 'private_invited',
    ),
  );

  const pendingPublicTemplates = await db
    .select()
    .from(dbSchema.schemaTemplates)
    .where(
      and(
        eq(dbSchema.schemaTemplates.createdBy, viewerUserId),
        eq(dbSchema.schemaTemplates.visibility, 'public'),
        eq(dbSchema.schemaTemplates.status, 'draft'),
        isNull(dbSchema.schemaTemplates.replacedById),
        inArray(dbSchema.schemaTemplates.reviewStatus, ['pending', 'changes_requested']),
      ),
    )
    .orderBy(desc(dbSchema.schemaTemplates.createdAt));

  const pendingIds = pendingPublicTemplates.map((t) => t.id);
  const pendingDatasets =
    pendingIds.length > 0
      ? await db
          .select()
          .from(dbSchema.datasetTemplates)
          .where(
            and(
              inArray(dbSchema.datasetTemplates.schemaTemplateId, pendingIds),
              eq(dbSchema.datasetTemplates.status, 'draft'),
            ),
          )
          .orderBy(desc(dbSchema.datasetTemplates.createdAt))
      : [];

  const pendingDatasetsBySchema = pendingDatasets.reduce<
    Record<string, Record<string, DatasetTemplateRow>>
  >((acc, dataset) => {
    const bucket = acc[dataset.schemaTemplateId] ?? {};
    if (!bucket[dataset.size]) {
      bucket[dataset.size] = dataset;
    }
    acc[dataset.schemaTemplateId] = bucket;
    return acc;
  }, {});

  const pendingPublicItems = pendingPublicTemplates.map((template) =>
    buildDatabaseItem(
      template,
      Object.values(pendingDatasetsBySchema[template.id] ?? {}),
      'public_pending_owner',
    ),
  );

  return [...publicItems, ...pendingPublicItems, ...privateItems];
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
  viewerUserId?: string | null,
): Promise<PaginatedDatabasesResult> {
  const catalog =
    viewerUserId != null && viewerUserId !== ''
      ? await loadViewerAccessibleCatalog(viewerUserId)
      : await loadDatabaseCatalog();
  const filtered = catalog.filter((database) => databaseMatchesListQuery(database, query));

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

export async function getDatabase(
  databaseId: string,
  opts?: { forChallengeAuthoring?: boolean; viewerUserId?: string | null },
): Promise<DatabaseItem> {
  const catalog =
    opts?.viewerUserId != null && opts.viewerUserId !== ''
      ? await loadViewerAccessibleCatalog(opts.viewerUserId)
      : await loadDatabaseCatalog();
  const database = catalog.find((item) => item.id === databaseId || item.slug === databaseId);

  if (!database) {
    throw new NotFoundError('Database not found');
  }

  if (opts?.forChallengeAuthoring && database.catalogKind === 'public_pending_owner') {
    throw new ValidationError(
      'This database is still awaiting catalog review and cannot be used for challenges yet.',
    );
  }

  return database;
}

export async function createDatabaseSession(
  userId: string,
  body: CreateDatabaseSessionBody,
): Promise<CreateDatabaseSessionResult> {
  const catalog = await loadViewerAccessibleCatalog(userId);
  const database = catalog.find((item) => item.id === body.databaseId || item.slug === body.databaseId);

  if (!database) {
    throw new NotFoundError('Database not found');
  }

  if (database.catalogKind === 'public_pending_owner') {
    throw new ValidationError(
      'This database is awaiting catalog review. Launch sandbox is available after an admin approves it.',
    );
  }

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

/** Full explorer-shaped payload for a public draft awaiting moderation (admin review UI). */
export async function getDatabaseItemForAdminPendingReview(
  schemaTemplateId: string,
): Promise<DatabaseItem> {
  const db = getDb();
  const [template] = await db
    .select()
    .from(dbSchema.schemaTemplates)
    .where(
      and(
        eq(dbSchema.schemaTemplates.id, schemaTemplateId),
        eq(dbSchema.schemaTemplates.visibility, 'public'),
        eq(dbSchema.schemaTemplates.status, 'draft'),
        eq(dbSchema.schemaTemplates.reviewStatus, 'pending'),
        isNull(dbSchema.schemaTemplates.replacedById),
      ),
    )
    .limit(1);

  if (!template) {
    throw new NotFoundError('Pending public database not found');
  }

  const datasetRows = await db
    .select()
    .from(dbSchema.datasetTemplates)
    .where(
      and(
        eq(dbSchema.datasetTemplates.schemaTemplateId, schemaTemplateId),
        eq(dbSchema.datasetTemplates.status, 'draft'),
      ),
    )
    .orderBy(desc(dbSchema.datasetTemplates.createdAt));

  const bySize: Record<string, DatasetTemplateRow> = {};
  for (const row of datasetRows) {
    if (!bySize[row.size]) {
      bySize[row.size] = row;
    }
  }

  return buildDatabaseItem(template, Object.values(bySize), 'public_pending_owner');
}
