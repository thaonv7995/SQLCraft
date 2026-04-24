CREATE TYPE "ai_provider_setting_scope" AS ENUM ('user', 'system');
--> statement-breakpoint
ALTER TABLE "ai_provider_settings" ADD COLUMN IF NOT EXISTS "scope" "ai_provider_setting_scope" DEFAULT 'user' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_provider_settings" ALTER COLUMN "user_id" DROP NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_provider_settings_scope_idx" ON "ai_provider_settings" ("scope");
