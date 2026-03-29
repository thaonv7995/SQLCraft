-- Speed up admin list of recent worker jobs (ORDER BY created_at DESC LIMIT n)

CREATE INDEX IF NOT EXISTS "system_jobs_created_at_idx"
ON "system_jobs" USING btree ("created_at" DESC);
