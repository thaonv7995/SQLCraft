DO $$ BEGIN
  CREATE TYPE "challenge_visibility" AS ENUM ('public', 'private');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "challenges" ADD COLUMN IF NOT EXISTS "visibility" "challenge_visibility" NOT NULL DEFAULT 'public';

CREATE TABLE IF NOT EXISTS "challenge_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "challenge_id" uuid NOT NULL REFERENCES "challenges"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "invited_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "challenge_invites_challenge_user_uidx" ON "challenge_invites" ("challenge_id", "user_id");
CREATE INDEX IF NOT EXISTS "challenge_invites_challenge_idx" ON "challenge_invites" ("challenge_id");
CREATE INDEX IF NOT EXISTS "challenge_invites_user_idx" ON "challenge_invites" ("user_id");
