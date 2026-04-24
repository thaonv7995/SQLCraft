CREATE TYPE "ai_chat_session_status" AS ENUM ('active', 'archived', 'deleted');

CREATE TABLE "ai_chat_sessions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "learning_session_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "title" varchar(160) NOT NULL DEFAULT 'AI Chat',
  "status" "ai_chat_session_status" NOT NULL DEFAULT 'active',
  "storage_key" text NOT NULL,
  "summary" text,
  "message_count" integer NOT NULL DEFAULT 0,
  "last_message_at" timestamp,
  "expires_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "ai_chat_sessions_learning_session_id_learning_sessions_id_fk" FOREIGN KEY ("learning_session_id") REFERENCES "learning_sessions"("id") ON DELETE cascade,
  CONSTRAINT "ai_chat_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE cascade
);

CREATE INDEX "ai_chat_sessions_session_status_idx" ON "ai_chat_sessions" ("learning_session_id", "status", "updated_at");
CREATE INDEX "ai_chat_sessions_user_session_idx" ON "ai_chat_sessions" ("user_id", "learning_session_id");
