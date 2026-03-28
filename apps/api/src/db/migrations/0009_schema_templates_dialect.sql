-- Template target SQL dialect + optional engine version (from dump / admin) for sandbox image selection.
ALTER TABLE "schema_templates" ADD COLUMN IF NOT EXISTS "dialect" varchar(32) DEFAULT 'postgresql-16' NOT NULL;
ALTER TABLE "schema_templates" ADD COLUMN IF NOT EXISTS "engine_version" varchar(64);
