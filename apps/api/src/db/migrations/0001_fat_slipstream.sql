DO $$ BEGIN
 CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'changes_requested', 'rejected');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "challenge_versions" ADD COLUMN "review_status" "review_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "challenge_versions" ADD COLUMN "review_notes" text;--> statement-breakpoint
ALTER TABLE "challenge_versions" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "challenge_versions" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "points" integer DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "challenges" ADD COLUMN "created_by" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "challenge_versions" ADD CONSTRAINT "challenge_versions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "challenges" ADD CONSTRAINT "challenges_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "challenge_versions_challenge_version_idx" ON "challenge_versions" ("challenge_id","version_no");