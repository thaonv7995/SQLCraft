import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb, schema } from '../../db';
import { ConflictError, NotFoundError, ValidationError } from '../../lib/errors';
import { splitStatements } from './sql-dump-scan';

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

/**
 * Strip SQL comments before keyword scanning. Without this a "harmless" looking
 * `-- drop table foo` line would trip the blocked-keyword regex even though the
 * server would never execute it.
 */
function stripSqlComments(stmt: string): string {
  let out = '';
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < stmt.length) {
    const ch = stmt[i];
    if (!inSingle && !inDouble && ch === '-' && stmt[i + 1] === '-') {
      const end = stmt.indexOf('\n', i + 2);
      i = end === -1 ? stmt.length : end + 1;
      out += ' ';
      continue;
    }
    if (!inSingle && !inDouble && ch === '/' && stmt[i + 1] === '*') {
      const end = stmt.indexOf('*/', i + 2);
      i = end === -1 ? stmt.length : end + 2;
      out += ' ';
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle || stmt[i + 1] === "'";
      if (inSingle && stmt[i + 1] === "'" && stmt[i] === "'") {
        out += "''";
        i += 2;
        continue;
      }
    }
    if (ch === '"' && !inSingle) inDouble = !inDouble;
    out += ch ?? '';
    i += 1;
  }
  return out;
}

export function validateGoldenSnapshotMigrationSql(input: string): { statements: string[]; warnings: string[] } {
  const statements = splitStatements(input);
  if (statements.length === 0) throw new ValidationError('Migration SQL is required.');
  if (statements.length > 30) throw new ValidationError('Too many statements. Please keep candidate migrations focused.');

  // Use ^ on the comment-stripped statement so allow-list matches the actual
  // first DDL keyword. Allowed: CREATE/DROP INDEX, REINDEX, CREATE/DROP
  // STATISTICS, ANALYZE, VACUUM ANALYZE.
  const blocked = /\b(drop\s+table|truncate|delete\s+from|update\s+\S+\s+set|insert\s+into|alter\s+table|drop\s+schema|create\s+table|grant|revoke|do\s+\$\$|copy\s)/i;
  const allowed = /^\s*(create\s+(unique\s+)?index(\s+concurrently)?|drop\s+index(\s+concurrently)?|reindex\b|create\s+statistics\b|drop\s+statistics\b|analyze\b|vacuum\s+analyze\b|vacuum\b)/i;
  const warnings: string[] = [];

  const effective: string[] = [];
  for (const statement of statements) {
    const cleaned = stripSqlComments(statement).trim();
    // Pure comment / whitespace statements are harmless — drop them silently.
    if (cleaned.length === 0) continue;
    if (blocked.test(cleaned)) {
      throw new ValidationError(`Blocked unsafe golden migration statement: ${statement.slice(0, 120)}`);
    }
    if (!allowed.test(cleaned)) {
      throw new ValidationError(`Only index/statistics/ANALYZE SQL is allowed in golden snapshot candidates: ${statement.slice(0, 120)}`);
    }
    if (/^\s*create\s+unique\s+index/i.test(cleaned)) {
      warnings.push('CREATE UNIQUE INDEX may fail if existing data contains duplicates. Validate carefully before promote.');
    }
    if (/^\s*drop\s+index/i.test(cleaned)) {
      warnings.push('DROP INDEX can reduce performance for existing challenge queries.');
    }
    effective.push(statement);
  }
  if (effective.length === 0) {
    throw new ValidationError('Migration SQL is required.');
  }

  return { statements: effective, warnings: Array.from(new Set(warnings)) };
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
      validationStatus: 'queued',
      changeNote: body.changeNote?.trim() || null,
      migrationSql: body.migrationSql.trim(),
      normalizedStatements: guard.statements,
      warnings: guard.warnings,
      createdBy: userId,
    })
    .returning();

  await getDb().insert(schema.goldenSnapshotValidationRuns).values({
    goldenSnapshotVersionId: row.id,
    status: 'queued',
    summary: 'SQL guard passed. Candidate bake queued.',
    details: { statements: guard.statements, warnings: guard.warnings },
    createdBy: userId,
  });

  const { enqueueGoldenSnapshotCandidateBake } = await import('../../lib/queue');
  await enqueueGoldenSnapshotCandidateBake({ goldenSnapshotVersionId: row.id });

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

  try {
    await db.transaction(async (tx) => {
      // Take an explicit row lock on the currently-active snapshot version (if any)
      // for this dataset_template_id. With the partial unique index
      // `golden_snapshot_versions_one_active_idx (dataset_template_id) WHERE status='active'`,
      // this serializes concurrent promotes for the same dataset and avoids a
      // window where the unique-violation surfaces as an internal error.
      await tx.execute(sql`
        SELECT id
          FROM golden_snapshot_versions
         WHERE dataset_template_id = ${candidate.datasetTemplateId}
           AND status = 'active'
         FOR UPDATE
      `);

      await tx
        .update(schema.goldenSnapshotVersions)
        .set({ status: 'archived', updatedAt: new Date() })
        .where(
          and(
            eq(schema.goldenSnapshotVersions.datasetTemplateId, candidate.datasetTemplateId),
            eq(schema.goldenSnapshotVersions.status, 'active'),
          ),
        );
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
  } catch (err) {
    if (isUniqueViolationError(err, 'golden_snapshot_versions_one_active_idx')) {
      throw new ConflictError('Another promote is already in progress for this dataset');
    }
    throw err;
  }

  return (await listGoldenSnapshotVersions(candidate.schemaTemplateId)).find((item) => item.id === id)!;
}

/**
 * Distinguish "unique partial index race" from other DB errors so promote race
 * surfaces as a 409 instead of a generic 500.
 */
function isUniqueViolationError(err: unknown, indexName: string): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; constraint?: string; constraint_name?: string; message?: string };
  if (e.code !== '23505') return false;
  if (e.constraint === indexName || e.constraint_name === indexName) return true;
  return typeof e.message === 'string' && e.message.includes(indexName);
}

export async function listGoldenSnapshotValidationRuns(id: string): Promise<GoldenSnapshotValidationRunDto[]> {
  const rows = await getDb()
    .select()
    .from(schema.goldenSnapshotValidationRuns)
    .where(eq(schema.goldenSnapshotValidationRuns.goldenSnapshotVersionId, id))
    .orderBy(desc(schema.goldenSnapshotValidationRuns.createdAt));
  return rows.map(toValidationDto);
}
