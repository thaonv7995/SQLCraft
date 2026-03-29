-- Golden snapshot metadata for fast sandbox provisioning (see sandbox golden volume plan).
-- Public API (Hướng A): user-facing lists require status = published AND sandbox_golden_status = ready (and fingerprint rules in app).

ALTER TABLE "dataset_templates" ADD COLUMN IF NOT EXISTS "sandbox_golden_snapshot_url" text;
ALTER TABLE "dataset_templates" ADD COLUMN IF NOT EXISTS "sandbox_golden_status" varchar(32) NOT NULL DEFAULT 'none';
ALTER TABLE "dataset_templates" ADD COLUMN IF NOT EXISTS "sandbox_golden_error" text;
ALTER TABLE "dataset_templates" ADD COLUMN IF NOT EXISTS "sandbox_golden_bytes" bigint;
ALTER TABLE "dataset_templates" ADD COLUMN IF NOT EXISTS "sandbox_golden_checksum" text;
ALTER TABLE "dataset_templates" ADD COLUMN IF NOT EXISTS "sandbox_golden_engine_image" text;
ALTER TABLE "dataset_templates" ADD COLUMN IF NOT EXISTS "sandbox_golden_artifact_fingerprint" text;

COMMENT ON COLUMN "dataset_templates"."sandbox_golden_status" IS 'none | pending | ready | failed';

-- Grandfather: published datasets without prior golden row → pending until worker runs golden-bake (fingerprint).
-- Catalog stays hidden from end-users until bake sets ready (see public API filters).
UPDATE "dataset_templates"
SET "sandbox_golden_status" = 'pending'
WHERE "status" = 'published' AND "sandbox_golden_status" = 'none';

CREATE INDEX IF NOT EXISTS "dataset_templates_sandbox_golden_status_idx" ON "dataset_templates" ("sandbox_golden_status");
