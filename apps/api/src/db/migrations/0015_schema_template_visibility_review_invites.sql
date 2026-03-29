ALTER TABLE "schema_templates" ADD COLUMN IF NOT EXISTS "visibility" "challenge_visibility" NOT NULL DEFAULT 'public';
ALTER TABLE "schema_templates" ADD COLUMN IF NOT EXISTS "review_status" "review_status" NOT NULL DEFAULT 'approved';

CREATE TABLE IF NOT EXISTS "schema_template_invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "schema_template_id" uuid NOT NULL REFERENCES "schema_templates"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "invited_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "schema_template_invites_schema_user_uidx" ON "schema_template_invites" ("schema_template_id", "user_id");
CREATE INDEX IF NOT EXISTS "schema_template_invites_schema_idx" ON "schema_template_invites" ("schema_template_id");
CREATE INDEX IF NOT EXISTS "schema_template_invites_user_idx" ON "schema_template_invites" ("user_id");
