ALTER TABLE "learning_sessions"
DROP COLUMN IF EXISTS "lesson_version_id";

ALTER TABLE "challenges"
DROP CONSTRAINT IF EXISTS "challenges_lesson_id_lessons_id_fk";

ALTER TABLE "challenges"
DROP COLUMN IF EXISTS "lesson_id";

DROP INDEX IF EXISTS "challenges_lesson_slug_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "challenges_database_slug_idx"
ON "challenges" USING btree ("database_id", "slug");

DROP TABLE IF EXISTS "lesson_versions" CASCADE;
DROP TABLE IF EXISTS "lessons" CASCADE;
DROP TABLE IF EXISTS "tracks" CASCADE;
