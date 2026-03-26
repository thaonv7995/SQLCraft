-- Cleanup legacy lesson/track constraints and indexes (idempotent)

ALTER TABLE "learning_sessions"
DROP CONSTRAINT IF EXISTS "learning_sessions_lesson_version_id_lesson_versions_id_fk";

ALTER TABLE "challenges"
DROP CONSTRAINT IF EXISTS "challenges_lesson_id_lessons_id_fk";

DROP INDEX IF EXISTS "challenges_lesson_slug_idx";
DROP INDEX IF EXISTS "lessons_track_slug_idx";
DROP INDEX IF EXISTS "lessons_track_sort_idx";
DROP INDEX IF EXISTS "lesson_versions_lesson_version_idx";
DROP INDEX IF EXISTS "tracks_slug_idx";
DROP INDEX IF EXISTS "tracks_status_sort_idx";

-- Re-assert required database linkage for challenges
ALTER TABLE "challenges"
ALTER COLUMN "database_id" SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'challenges_database_id_schema_templates_id_fk'
  ) THEN
    ALTER TABLE "challenges"
    ADD CONSTRAINT "challenges_database_id_schema_templates_id_fk"
    FOREIGN KEY ("database_id") REFERENCES "schema_templates"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "challenges_database_idx"
ON "challenges" USING btree ("database_id");

CREATE UNIQUE INDEX IF NOT EXISTS "challenges_database_slug_idx"
ON "challenges" USING btree ("database_id", "slug");
