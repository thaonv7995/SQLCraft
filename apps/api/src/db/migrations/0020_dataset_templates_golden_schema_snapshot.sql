-- Canonical schema snapshot (JSON) captured during golden-bake after restore; used as schema-diff base
-- so diff matches post-restore DB (indexes, etc.) instead of partial template JSON.
ALTER TABLE "dataset_templates" ADD COLUMN IF NOT EXISTS "sandbox_golden_schema_snapshot_url" text;

COMMENT ON COLUMN "dataset_templates"."sandbox_golden_schema_snapshot_url" IS 's3://…/golden-snapshots/{id}/schema-snapshot.json; set when golden-bake introspects DB after restore';
