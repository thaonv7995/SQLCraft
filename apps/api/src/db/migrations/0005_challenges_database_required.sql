ALTER TABLE "challenges"
ADD COLUMN "database_id" uuid;

WITH lesson_schema AS (
  SELECT
    l.id AS lesson_id,
    COALESCE(
      lv.schema_template_id,
      (
        SELECT lv2.schema_template_id
        FROM "lesson_versions" lv2
        WHERE lv2.lesson_id = l.id
          AND lv2.schema_template_id IS NOT NULL
        ORDER BY lv2.is_published DESC, lv2.version_no DESC
        LIMIT 1
      )
    ) AS schema_template_id
  FROM "lessons" l
  LEFT JOIN "lesson_versions" lv
    ON lv.id = l.published_version_id
)
UPDATE "challenges" c
SET "database_id" = ls.schema_template_id
FROM lesson_schema ls
WHERE c.lesson_id = ls.lesson_id
  AND c.database_id IS NULL;

-- Fallback for orphan/legacy challenges that cannot resolve via lesson_versions:
-- assign the most recently created schema template so migration can proceed.
UPDATE "challenges" c
SET "database_id" = st.id
FROM (
  SELECT id
  FROM "schema_templates"
  ORDER BY "created_at" DESC
  LIMIT 1
) st
WHERE c.database_id IS NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "challenges" WHERE "database_id" IS NULL) THEN
    RAISE EXCEPTION 'Unable to backfill challenges.database_id for all rows';
  END IF;
END $$;

ALTER TABLE "challenges"
ALTER COLUMN "database_id" SET NOT NULL;

ALTER TABLE "challenges"
ADD CONSTRAINT "challenges_database_id_schema_templates_id_fk"
FOREIGN KEY ("database_id") REFERENCES "schema_templates"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

CREATE INDEX "challenges_database_idx" ON "challenges" USING btree ("database_id");
