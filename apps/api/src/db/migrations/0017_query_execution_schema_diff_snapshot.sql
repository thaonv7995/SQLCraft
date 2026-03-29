ALTER TABLE "query_executions" ADD COLUMN IF NOT EXISTS "schema_diff_snapshot" jsonb;
