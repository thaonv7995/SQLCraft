ALTER TYPE "public"."query_status" ADD VALUE 'cancelled';
ALTER TABLE "query_executions" ADD COLUMN IF NOT EXISTS "bull_job_id" varchar(64);
ALTER TABLE "query_executions" ADD COLUMN IF NOT EXISTS "db_backend_pid" bigint;
