CREATE INDEX IF NOT EXISTS "sql_dump_upload_sessions_state_expires_idx"
  ON "sql_dump_upload_sessions" ("state", "expires_at")
  WHERE "state" IN ('pending', 'completing');
