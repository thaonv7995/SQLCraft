import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '../../db';
import { NotFoundError, ValidationError } from '../../lib/errors';

const DATASET_SCALE_ORDER = ['tiny', 'small', 'medium', 'large', 'extra_large'] as const;

export interface GoldenSnapshotVersionDto {
  id: string;
  schemaTemplateId: string;
  datasetTemplateId: string;
  datasetName: string;
  datasetSize: string;
  versionNo: number;
  status: string;
  validationStatus: string;
  changeNote: string | null;
  migrationSql: string | null;
  normalizedStatements: string[];
  warnings: string[];
  snapshotUrl: string | null;
  schemaSnapshotUrl: string | null;
  snapshotBytes: number | null;
  snapshotChecksum: string | null;
  createdBy: string | null;
  promotedBy: string | null;
  promotedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GoldenSnapshotValidationRunDto {
  id: string;
  goldenSnapshotVersionId: string;
  status: string;
  summary: string | null;
  details: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function toVersionDto(row: typeof schema.goldenSnapshotVersions.$inferSelect & { datasetName: string; datasetSize: string }): GoldenSnapshotVersionDto {
  return {
    id: row.id,
    schemaTemplateId: row.schemaTemplateId,
    datasetTemplateId: row.datasetTemplateId,
    datasetName: row.datasetName,
    datasetSize: row.datasetSize,
    versionNo: row.versionNo,
    status: row.status,
    validationStatus: row.validationStatus,
    changeNote: row.changeNote,
    migrationSql: row.migrationSql,
    normalizedStatements: toStringArray(row.normalizedStatements),
    warnings: toStringArray(row.warnings),
    snapshotUrl: row.snapshotUrl,
    schemaSnapshotUrl: row.schemaSnapshotUrl,
    snapshotBytes: row.snapshotBytes,
    snapshotChecksum: row.snapshotChecksum,
    createdBy: row.createdBy,
    promotedBy: row.promotedBy,
    promotedAt: row.promotedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toValidationDto(row: typeof schema.goldenSnapshotValidationRuns.$inferSelect): GoldenSnapshotValidationRunDto {
  return {
    id: row.id,
    goldenSnapshotVersionId: row.goldenSnapshotVersionId,
    status: row.status,
    summary: row.summary,
    details: row.details && typeof row.details === 'object' ? row.details as Record<string, unknown> : {},
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

function splitSqlStatements(input: string): string[] {
  return input
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export function validateGoldenSnapshotMigrationSql(input: string): { statements: string[]; warnings: string[] } {
  const statements = splitSqlStatements(input);
  if (statements.length === 0) throw new ValidationError('Migration SQL is required.');
  if (statements.length > 30) throw new ValidationError('Too many statements. Please keep candidate migrations focused.');

  const blocked = /\b(drop\s+table|truncate|delete\s+from|update\s+\S+\s+set|insert\s+into|alter\s+table|drop\s+schema|create\s+table|grant|revoke)\b/i;
  const allowed = /^\s*(create\s+(unique\s+)?index(\s+concurrently)?|drop\s+index(\s+concurrently)?|reindex\b|create\s+statistics\b)/i;
  const warnings: string[] = [];

  for (const statement of statements) {
    if (blocked.test(statement)) {
      throw new ValidationError(`Blocked unsafe golden migration statement: ${statement.slice(0, 120)}`);
    }
    if (!allowed.test(statement)) {
      throw new ValidationError(`Only index/statistics related SQL is allowed in golden snapshot candidates: ${statement.slice(0, 120)}`);
    }
    if (/^\s*create\s+unique\s+index/i.test(statement)) {
      warnings.push('CREATE UNIQUE INDEX may fail if existing data contains duplicates. Validate carefully before promote.');
    }
    if (/^\s*drop\s+index/i.test(statement)) {
      warnings.push('DROP INDEX can reduce performance for existing challenge queries.');
    }
  }

  return { statements, warnings: Array.from(new Set(warnings)) };
}

async function resolveSourceDataset(schemaTemplateId: string) {
  const rows = await getDb()
    .select()
    .from(schema.datasetTemplates)
    .where(and(eq(schema.datasetTemplates.schemaTemplateId, schemaTemplateId), eq(schema.datasetTemplates.status, 'published')));
  if (rows.length === 0) throw new NotFoundError('No published dataset templates found for this schema.');
  return rows.sort((left, right) => DATASET_SCALE_ORDER.indexOf(left.size as (typeof DATASET_SCALE_ORDER)[number]) - DATASET_SCALE_ORDER.indexOf(right.size as (typeof DATASET_SCALE_ORDER)[number]))[0];
}

async function ensureLegacyActiveVersion(datasetTemplateId: string): Promise<void> {
  const db = getDb();
  const [existing] = await db
    .select()
    .from(schema.goldenSnapshotVersions)
    .where(eq(schema.goldenSnapshotVersions.datasetTemplateId, datasetTemplateId))
    .limit(1);
  if (existing) return;

  const [dataset] = await db.select().from(schema.datasetTemplates).where(eq(schema.datasetTemplates.id, datasetTemplateId)).limit(1);
  if (!dataset || dataset.sandboxGoldenStatus !== 'ready') return;

  await db.insert(schema.goldenSnapshotVersions).values({
    schemaTemplateId: dataset.schemaTemplateId,
    datasetTemplateId: dataset.id,
    versionNo: 1,
    status: 'active',
    validationStatus: 'legacy_ready',
    changeNote: 'Bootstrapped from existing golden snapshot',
    normalizedStatements: [],
    warnings: [],
    snapshotUrl: dataset.sandboxGoldenSnapshotUrl,
    schemaSnapshotUrl: dataset.sandboxGoldenSchemaSnapshotUrl,
    snapshotBytes: dataset.sandboxGoldenBytes,
    snapshotChecksum: dataset.sandboxGoldenChecksum,
    promotedAt: new Date(),
  });
}

export async function listGoldenSnapshotVersions(schemaTemplateId: string): Promise<GoldenSnapshotVersionDto[]> {
  const dataset = await resolveSourceDataset(schemaTemplateId);
  await ensureLegacyActiveVersion(dataset.id);

  const rows = await getDb()
    .select({
      id: schema.goldenSnapshotVersions.id,
      schemaTemplateId: schema.goldenSnapshotVersions.schemaTemplateId,
      datasetTemplateId: schema.goldenSnapshotVersions.datasetTemplateId,
      datasetName: schema.datasetTemplates.name,
      datasetSize: schema.datasetTemplates.size,
      versionNo: schema.goldenSnapshotVersions.versionNo,
      status: schema.goldenSnapshotVersions.status,
      validationStatus: schema.goldenSnapshotVersions.validationStatus,
      changeNote: schema.goldenSnapshotVersions.changeNote,
      migrationSql: schema.goldenSnapshotVersions.migrationSql,
      normalizedStatements: schema.goldenSnapshotVersions.normalizedStatements,
      warnings: schema.goldenSnapshotVersions.warnings,
      snapshotUrl: schema.goldenSnapshotVersions.snapshotUrl,
      schemaSnapshotUrl: schema.goldenSnapshotVersions.schemaSnapshotUrl,
      snapshotBytes: schema.goldenSnapshotVersions.snapshotBytes,
      snapshotChecksum: schema.goldenSnapshotVersions.snapshotChecksum,
      createdBy: schema.goldenSnapshotVersions.createdBy,
      promotedBy: schema.goldenSnapshotVersions.promotedBy,
      promotedAt: schema.goldenSnapshotVersions.promotedAt,
      createdAt: schema.goldenSnapshotVersions.createdAt,
      updatedAt: schema.goldenSnapshotVersions.updatedAt,
    })
    .from(schema.goldenSnapshotVersions)
    .innerJoin(schema.datasetTemplates, eq(schema.datasetTemplates.id, schema.goldenSnapshotVersions.datasetTemplateId))
    .where(eq(schema.goldenSnapshotVersions.schemaTemplateId, schemaTemplateId))
    .orderBy(desc(schema.goldenSnapshotVersions.createdAt));

  return rows.map(toVersionDto);
}

export async function createGoldenSnapshotCandidate(
  schemaTemplateId: string,
  userId: string,
  body: { migrationSql: string; changeNote?: string },
): Promise<GoldenSnapshotVersionDto> {
  const dataset = await resolveSourceDataset(schemaTemplateId);
  await ensureLegacyActiveVersion(dataset.id);
  const guard = validateGoldenSnapshotMigrationSql(body.migrationSql);
  const [{ nextVersionNo }] = await getDb()
    .select({ nextVersionNo: sql<number>`coalesce(max(${schema.goldenSnapshotVersions.versionNo}), 0) + 1` })
    .from(schema.goldenSnapshotVersions)
    .where(eq(schema.goldenSnapshotVersions.datasetTemplateId, dataset.id));

  const [row] = await getDb()
    .insert(schema.goldenSnapshotVersions)
    .values({
      schemaTemplateId,
      datasetTemplateId: dataset.id,
      versionNo: Number(nextVersionNo ?? 1),
      status: 'candidate',
      validationStatus: 'guard_passed',
      changeNote: body.changeNote?.trim() || null,
      migrationSql: body.migrationSql.trim(),
      normalizedStatements: guard.statements,
      warnings: guard.warnings,
      createdBy: userId,
    })
    .returning();

  await getDb().insert(schema.goldenSnapshotValidationRuns).values({
    goldenSnapshotVersionId: row.id,
    status: 'guard_passed',
    summary: 'SQL guard passed. Candidate bake/apply worker is required before promotion.',
    details: { statements: guard.statements, warnings: guard.warnings },
    createdBy: userId,
  });

  return (await listGoldenSnapshotVersions(schemaTemplateId)).find((item) => item.id === row.id)!;
}

export async function promoteGoldenSnapshotVersion(id: string, userId: string): Promise<GoldenSnapshotVersionDto> {
  const db = getDb();
  const [candidate] = await db.select().from(schema.goldenSnapshotVersions).where(eq(schema.goldenSnapshotVersions.id, id)).limit(1);
  if (!candidate) throw new NotFoundError('Golden snapshot version not found');
  if (candidate.status !== 'candidate') throw new ValidationError('Only candidate golden snapshots can be promoted.');
  if (candidate.validationStatus !== 'passed' || !candidate.snapshotUrl) {
    throw new ValidationError('Candidate must be baked and fully validated before promote.');
  }

  await db.transaction(async (tx) => {
    await tx
      .update(schema.goldenSnapshotVersions)
      .set({ status: 'archived', updatedAt: new Date() })
      .where(and(eq(schema.goldenSnapshotVersions.datasetTemplateId, candidate.datasetTemplateId), eq(schema.goldenSnapshotVersions.status, 'active')));
    await tx
      .update(schema.goldenSnapshotVersions)
      .set({ status: 'active', promotedBy: userId, promotedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.goldenSnapshotVersions.id, id));
    await tx
      .update(schema.datasetTemplates)
      .set({
        sandboxGoldenStatus: 'ready',
        sandboxGoldenError: null,
        sandboxGoldenSnapshotUrl: candidate.snapshotUrl,
        sandboxGoldenSchemaSnapshotUrl: candidate.schemaSnapshotUrl,
        sandboxGoldenBytes: candidate.snapshotBytes,
        sandboxGoldenChecksum: candidate.snapshotChecksum,
      })
      .where(eq(schema.datasetTemplates.id, candidate.datasetTemplateId));
  });

  return (await listGoldenSnapshotVersions(candidate.schemaTemplateId)).find((item) => item.id === id)!;
}

export async function listGoldenSnapshotValidationRuns(id: string): Promise<GoldenSnapshotValidationRunDto[]> {
  const rows = await getDb()
    .select()
    .from(schema.goldenSnapshotValidationRuns)
    .where(eq(schema.goldenSnapshotValidationRuns.goldenSnapshotVersionId, id))
    .orderBy(desc(schema.goldenSnapshotValidationRuns.createdAt));
  return rows.map(toValidationDto);
}
