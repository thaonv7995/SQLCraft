CREATE TYPE "ai_provider" AS ENUM ('openai', 'anthropic', 'gemini', 'openai-compatible');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_provider_settings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "provider" "ai_provider" NOT NULL,
  "name" varchar(100) NOT NULL,
  "base_url" text,
  "model" varchar(160) NOT NULL,
  "encrypted_api_key" text NOT NULL,
  "is_enabled" boolean DEFAULT true NOT NULL,
  "is_default" boolean DEFAULT false NOT NULL,
  "last_test_status" varchar(24),
  "last_test_message" text,
  "last_tested_at" timestamp,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_provider_settings_user_idx" ON "ai_provider_settings" ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_provider_settings_user_default_idx" ON "ai_provider_settings" ("user_id", "is_default");
