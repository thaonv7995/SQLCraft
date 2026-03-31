CREATE TABLE IF NOT EXISTS "sql_dump_scans" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "file_name" text NOT NULL,
  "byte_size" bigint NOT NULL,
  "artifact_url" text NOT NULL,
  "metadata_url" text NOT NULL,
  "artifact_only" boolean DEFAULT false NOT NULL,
  "status" varchar(24) DEFAULT 'queued' NOT NULL,
  "progress_bytes" bigint DEFAULT 0 NOT NULL,
  "total_bytes" bigint,
  "total_rows" bigint,
  "error_message" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sql_dump_scans_user_id_idx" ON "sql_dump_scans" ("user_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sql_dump_scans_status_idx" ON "sql_dump_scans" ("status","updated_at");

