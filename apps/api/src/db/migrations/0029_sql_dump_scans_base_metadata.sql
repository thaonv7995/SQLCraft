ALTER TABLE "sql_dump_scans" ADD COLUMN IF NOT EXISTS "base_scan_json" jsonb;
--> statement-breakpoint
ALTER TABLE "sql_dump_scans" ADD COLUMN IF NOT EXISTS "last_heartbeat_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sql_dump_scans_status_heartbeat_idx" ON "sql_dump_scans" ("status", "last_heartbeat_at");
