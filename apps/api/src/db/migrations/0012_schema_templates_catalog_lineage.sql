-- Catalog lineage: stable anchor id + replace chain (new default supersedes old; old kept as fallback rows)

ALTER TABLE "schema_templates"
ADD COLUMN IF NOT EXISTS "catalog_anchor_id" uuid,
ADD COLUMN IF NOT EXISTS "replaced_by_id" uuid;

UPDATE "schema_templates"
SET "catalog_anchor_id" = "id"
WHERE "catalog_anchor_id" IS NULL;

ALTER TABLE "schema_templates" ALTER COLUMN "catalog_anchor_id" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'schema_templates_replaced_by_id_fkey'
  ) THEN
    ALTER TABLE "schema_templates"
    ADD CONSTRAINT "schema_templates_replaced_by_id_fkey"
    FOREIGN KEY ("replaced_by_id") REFERENCES "schema_templates"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "schema_templates_catalog_anchor_idx"
ON "schema_templates" USING btree ("catalog_anchor_id");

CREATE INDEX IF NOT EXISTS "schema_templates_published_head_idx"
ON "schema_templates" USING btree ("status")
WHERE "replaced_by_id" IS NULL;
