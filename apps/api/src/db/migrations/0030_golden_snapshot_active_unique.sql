CREATE UNIQUE INDEX IF NOT EXISTS "golden_snapshot_versions_one_active_idx"
  ON "golden_snapshot_versions" ("dataset_template_id")
  WHERE "status" = 'active';
