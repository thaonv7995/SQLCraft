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
  /** When set, sandbox provisioning restores this snapshot (S3) instead of re-streaming `artifact_url`. */
  sandboxGoldenSnapshotUrl: string | null;
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

/** Dialect + engine_version for sandbox Docker image selection. */
export async function fetchSchemaTemplateSandboxMeta(
  schemaTemplateId: string,
): Promise<{ dialect: string; engineVersion: string | null } | null> {
  const result = await mainDb.query<{
    dialect: string;
    engineVersion: string | null;
  }>(
    'SELECT dialect, engine_version AS "engineVersion" FROM schema_templates WHERE id = $1',
    [schemaTemplateId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { dialect: row.dialect, engineVersion: row.engineVersion };
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
    sandboxGoldenSnapshotUrl: string | null;
  }>(
    `SELECT id,
            schema_template_id AS "schemaTemplateId",
            name,
            size,
            row_counts AS "rowCounts",
            artifact_url AS "artifactUrl",
            sandbox_golden_snapshot_url AS "sandboxGoldenSnapshotUrl"
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
    sandboxGoldenSnapshotUrl: row.sandboxGoldenSnapshotUrl,
  };
}

/** Golden bake succeeded: fingerprint + engine image + optional snapshot object in object storage. */
export async function updateDatasetGoldenBakeSuccess(
  datasetTemplateId: string,
  params: {
    artifactFingerprint: string;
    engineImage: string | null;
    snapshotUrl: string | null;
    snapshotBytes: number | null;
    snapshotChecksumSha256: string | null;
  },
): Promise<void> {
  await mainDb.query(
    `UPDATE dataset_templates
     SET sandbox_golden_status = 'ready',
         sandbox_golden_error = NULL,
         sandbox_golden_artifact_fingerprint = $2,
         sandbox_golden_engine_image = $3,
         sandbox_golden_snapshot_url = $4,
         sandbox_golden_bytes = $5,
         sandbox_golden_checksum = $6
     WHERE id = $1`,
    [
      datasetTemplateId,
      params.artifactFingerprint,
      params.engineImage,
      params.snapshotUrl,
      params.snapshotBytes,
      params.snapshotChecksumSha256,
    ],
  );
}

export async function updateDatasetGoldenBakeFailed(
  datasetTemplateId: string,
  errorMessage: string,
): Promise<void> {
  await mainDb.query(
    `UPDATE dataset_templates
     SET sandbox_golden_status = 'failed',
         sandbox_golden_error = $2
     WHERE id = $1`,
    [datasetTemplateId, errorMessage],
  );
}

/** When BullMQ fails the job (e.g. stalled) without the processor throwing, only update if still pending. */
export async function updateDatasetGoldenBakeFailedIfPending(
  datasetTemplateId: string,
  errorMessage: string,
): Promise<void> {
  await mainDb.query(
    `UPDATE dataset_templates
     SET sandbox_golden_status = 'failed',
         sandbox_golden_error = $2
     WHERE id = $1 AND sandbox_golden_status = 'pending'`,
    [datasetTemplateId, errorMessage],
  );
}

/** Published datasets with pending golden and a non-empty artifact — eligible for enqueue (worker scan). */
export async function fetchDatasetTemplateIdsPendingGoldenBake(): Promise<string[]> {
  const result = await mainDb.query<{ id: string }>(
    `SELECT id
       FROM dataset_templates
      WHERE status = 'published'
        AND sandbox_golden_status = 'pending'
        AND artifact_url IS NOT NULL
        AND TRIM(artifact_url) <> ''`,
  );
  return result.rows.map((r) => r.id);
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
  sandboxEngine: string;
  sandboxDbPort: number;
} | null> {
  const result = await mainDb.query(
    `SELECT id,
            db_name AS "dbName",
            container_ref AS "containerRef",
            status,
            learning_session_id AS "learningSessionId",
            schema_template_id AS "schemaTemplateId",
            dataset_template_id AS "datasetTemplateId",
            sandbox_engine AS "sandboxEngine",
            sandbox_db_port AS "sandboxDbPort"
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
  sandboxEngine: string,
  sandboxDbPort: number,
): Promise<void> {
  await mainDb.query(
    `UPDATE sandbox_instances
     SET status = 'ready', db_name = $2, container_ref = $3,
         expires_at = $4, sandbox_engine = $5, sandbox_db_port = $6, updated_at = now()
     WHERE id = $1`,
    [sandboxId, dbName, containerRef, expiresAt, sandboxEngine, sandboxDbPort],
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

/** Align `last_activity_at` with sandbox `expires_at` baseline when sandbox becomes ready. */
export async function touchLearningSessionActivity(sessionId: string): Promise<void> {
  await mainDb.query(
    'UPDATE learning_sessions SET last_activity_at = now() WHERE id = $1',
    [sessionId],
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
  schemaDiffSnapshot?: unknown,
): Promise<boolean> {
  const r = await mainDb.query(
    `UPDATE query_executions
     SET status = 'succeeded',
         duration_ms = $2,
         rows_returned = $3,
         result_preview = $4,
         schema_diff_snapshot = $5
     WHERE id = $1 AND status = 'running'
     RETURNING id`,
    [
      executionId,
      durationMs,
      rowsReturned,
      JSON.stringify(resultPreview),
      schemaDiffSnapshot != null ? JSON.stringify(schemaDiffSnapshot) : null,
    ],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function updateQueryExecutionFailed(
  executionId: string,
  status: 'failed' | 'timed_out' | 'blocked' | 'cancelled',
  errorMessage: string,
  durationMs?: number,
): Promise<void> {
  await mainDb.query(
    `UPDATE query_executions
     SET status = $2, error_message = $3, duration_ms = $4
     WHERE id = $1 AND status IN ('accepted', 'running')`,
    [executionId, status, errorMessage, durationMs ?? null],
  );
}

export async function updateQueryExecutionBackendPid(
  executionId: string,
  backendPid: number,
): Promise<void> {
  await mainDb.query(
    `UPDATE query_executions SET db_backend_pid = $2 WHERE id = $1`,
    [executionId, backendPid],
  );
}

export async function fetchQueryExecutionForCancel(executionId: string): Promise<{
  id: string;
  status: string;
  sandboxInstanceId: string | null;
  bullJobId: string | null;
  dbBackendPid: string | null;
} | null> {
  const result = await mainDb.query(
    `SELECT id,
            status,
            sandbox_instance_id AS "sandboxInstanceId",
            bull_job_id AS "bullJobId",
            db_backend_pid::text AS "dbBackendPid"
       FROM query_executions
      WHERE id = $1`,
    [executionId],
  );
  return result.rows[0] ?? null;
}

export async function tryMarkQueryExecutionCancelled(
  executionId: string,
  errorMessage: string,
): Promise<boolean> {
  const r = await mainDb.query(
    `UPDATE query_executions
     SET status = 'cancelled', error_message = $2
     WHERE id = $1 AND status IN ('accepted', 'running')
     RETURNING id`,
    [executionId, errorMessage],
  );
  return (r.rowCount ?? 0) > 0;
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
