CREATE TABLE IF NOT EXISTS "golden_snapshot_versions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "schema_template_id" uuid NOT NULL REFERENCES "schema_templates"("id") ON DELETE CASCADE,
  "dataset_template_id" uuid NOT NULL REFERENCES "dataset_templates"("id") ON DELETE CASCADE,
  "version_no" integer NOT NULL,
  "status" varchar(32) NOT NULL DEFAULT 'candidate',
  "validation_status" varchar(32) NOT NULL DEFAULT 'pending',
  "change_note" text,
  "migration_sql" text,
  "normalized_statements" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "warnings" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "snapshot_url" text,
  "schema_snapshot_url" text,
  "snapshot_bytes" bigint,
  "snapshot_checksum" text,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "promoted_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "promoted_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "golden_snapshot_versions_dataset_version_idx" ON "golden_snapshot_versions" ("dataset_template_id", "version_no");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "golden_snapshot_versions_schema_idx" ON "golden_snapshot_versions" ("schema_template_id", "status", "created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "golden_snapshot_versions_one_active_idx" ON "golden_snapshot_versions" ("dataset_template_id") WHERE "status" = 'active';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "golden_snapshot_validation_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "golden_snapshot_version_id" uuid NOT NULL REFERENCES "golden_snapshot_versions"("id") ON DELETE CASCADE,
  "status" varchar(32) NOT NULL,
  "summary" text,
  "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "golden_snapshot_validation_runs_version_idx" ON "golden_snapshot_validation_runs" ("golden_snapshot_version_id", "created_at");
