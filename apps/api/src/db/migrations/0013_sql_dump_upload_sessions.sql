CREATE TABLE IF NOT EXISTS "sql_dump_upload_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "staging_key" text NOT NULL,
  "upload_mode" varchar(16) NOT NULL,
  "upload_id" text,
  "expected_byte_size" bigint NOT NULL,
  "part_size" bigint,
  "file_name" text NOT NULL,
  "artifact_only" boolean DEFAULT false NOT NULL,
  "state" varchar(24) DEFAULT 'pending' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "expires_at" timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS "sql_dump_upload_sessions_user_id_idx" ON "sql_dump_upload_sessions" ("user_id");
CREATE INDEX IF NOT EXISTS "sql_dump_upload_sessions_expires_at_idx" ON "sql_dump_upload_sessions" ("expires_at");
