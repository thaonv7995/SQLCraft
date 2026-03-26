import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://sqlcraft:sqlcraft@localhost:5432/sqlcraft';

export const mainDb = new Pool({ connectionString: databaseUrl, max: 5 });

// ─── Schema template ──────────────────────────────────────────────────────────

export interface RawColumn {
  name: string;
  type: string;
}

export interface RawTable {
  name: string;
  columns: RawColumn[];
}

export interface SchemaMetadata {
  source?: string;
  [key: string]: unknown;
}

export interface SchemaDefinition {
  tables: RawTable[];
  metadata?: SchemaMetadata;
}

export interface DatasetTemplateDefinition {
  id: string;
  schemaTemplateId: string;
  name: string;
  size: string;
  rowCounts: Record<string, unknown>;
  artifactUrl: string | null;
}

export async function fetchSchemaTemplate(
  schemaTemplateId: string,
): Promise<SchemaDefinition | null> {
  const result = await mainDb.query<{ definition: unknown }>(
    'SELECT definition FROM schema_templates WHERE id = $1',
    [schemaTemplateId],
  );
  if (!result.rows[0]) return null;
  const def = result.rows[0].definition;
  if (!def || typeof def !== 'object') return null;
  return def as SchemaDefinition;
}

export async function fetchDatasetTemplate(
  datasetTemplateId: string,
): Promise<DatasetTemplateDefinition | null> {
  const result = await mainDb.query<{
    id: string;
    schemaTemplateId: string;
    name: string;
    size: string;
    rowCounts: unknown;
    artifactUrl: string | null;
  }>(
    `SELECT id,
            schema_template_id AS "schemaTemplateId",
            name,
            size,
            row_counts AS "rowCounts",
            artifact_url AS "artifactUrl"
       FROM dataset_templates
      WHERE id = $1`,
    [datasetTemplateId],
  );

  const row = result.rows[0];
  if (!row) return null;

  return {
    id: row.id,
    schemaTemplateId: row.schemaTemplateId,
    name: row.name,
    size: row.size,
    rowCounts:
      row.rowCounts && typeof row.rowCounts === 'object'
        ? (row.rowCounts as Record<string, unknown>)
        : {},
    artifactUrl: row.artifactUrl,
  };
}

// ─── Sandbox instance ─────────────────────────────────────────────────────────

export async function fetchSandbox(
  sandboxId: string,
): Promise<{
  id: string;
  dbName: string | null;
  containerRef: string | null;
  status: string;
  learningSessionId: string;
  schemaTemplateId: string | null;
  datasetTemplateId: string | null;
} | null> {
  const result = await mainDb.query(
    `SELECT id,
            db_name AS "dbName",
            container_ref AS "containerRef",
            status,
            learning_session_id AS "learningSessionId",
            schema_template_id AS "schemaTemplateId",
            dataset_template_id AS "datasetTemplateId"
       FROM sandbox_instances
      WHERE id = $1`,
    [sandboxId],
  );
  return result.rows[0] ?? null;
}

export async function updateSandboxReady(
  sandboxId: string,
  dbName: string,
  containerRef: string,
  expiresAt: Date,
): Promise<void> {
  await mainDb.query(
    `UPDATE sandbox_instances
     SET status = 'ready', db_name = $2, container_ref = $3,
         expires_at = $4, updated_at = now()
     WHERE id = $1`,
    [sandboxId, dbName, containerRef, expiresAt],
  );
}

export async function updateSandboxStatus(
  sandboxId: string,
  status: string,
): Promise<void> {
  await mainDb.query(
    'UPDATE sandbox_instances SET status = $2, updated_at = now() WHERE id = $1',
    [sandboxId, status],
  );
}

export async function updateSandboxExpiresAt(sandboxId: string, expiresAt: Date): Promise<void> {
  await mainDb.query(
    'UPDATE sandbox_instances SET expires_at = $2, updated_at = now() WHERE id = $1',
    [sandboxId, expiresAt],
  );
}

// ─── Learning session ─────────────────────────────────────────────────────────

export async function updateSessionStatus(
  sessionId: string,
  status: string,
): Promise<void> {
  await mainDb.query(
    'UPDATE learning_sessions SET status = $2 WHERE id = $1',
    [sessionId, status],
  );
}

// ─── Query execution ──────────────────────────────────────────────────────────

export async function fetchQueryExecution(
  executionId: string,
): Promise<{ id: string; sqlText: string; sandboxInstanceId: string | null } | null> {
  const result = await mainDb.query(
    'SELECT id, sql_text AS "sqlText", sandbox_instance_id AS "sandboxInstanceId" FROM query_executions WHERE id = $1',
    [executionId],
  );
  return result.rows[0] ?? null;
}

export async function updateQueryExecutionRunning(executionId: string): Promise<void> {
  await mainDb.query(
    "UPDATE query_executions SET status = 'running' WHERE id = $1",
    [executionId],
  );
}

export async function updateQueryExecutionSuccess(
  executionId: string,
  durationMs: number,
  rowsReturned: number,
  resultPreview: unknown,
): Promise<void> {
  await mainDb.query(
    `UPDATE query_executions
     SET status = 'succeeded', duration_ms = $2, rows_returned = $3, result_preview = $4
     WHERE id = $1`,
    [executionId, durationMs, rowsReturned, JSON.stringify(resultPreview)],
  );
}

export async function updateQueryExecutionFailed(
  executionId: string,
  status: 'failed' | 'timed_out' | 'blocked',
  errorMessage: string,
  durationMs?: number,
): Promise<void> {
  await mainDb.query(
    `UPDATE query_executions
     SET status = $2, error_message = $3, duration_ms = $4
     WHERE id = $1`,
    [executionId, status, errorMessage, durationMs ?? null],
  );
}

export async function insertQueryExecutionPlan(
  queryExecutionId: string,
  planMode: 'explain' | 'explain_analyze',
  rawPlan: unknown,
  planSummary: unknown,
): Promise<void> {
  await mainDb.query(
    `INSERT INTO query_execution_plans (id, query_execution_id, plan_mode, raw_plan, plan_summary, created_at)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, now())`,
    [queryExecutionId, planMode, JSON.stringify(rawPlan), JSON.stringify(planSummary)],
  );
}

// ─── Expiry scanner ───────────────────────────────────────────────────────────

export async function fetchExpiredSandboxes(): Promise<
  Array<{ id: string; learningSessionId: string; dbName: string | null }>
> {
  const result = await mainDb.query(
    `SELECT id, learning_session_id AS "learningSessionId", db_name AS "dbName"
     FROM sandbox_instances
     WHERE expires_at < now()
       AND status NOT IN ('destroyed', 'failed', 'expiring')`,
  );
  return result.rows;
}
