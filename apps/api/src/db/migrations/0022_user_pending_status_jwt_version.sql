-- Add 'pending' status for users awaiting admin approval after self-registration
ALTER TYPE "user_status" ADD VALUE IF NOT EXISTS 'pending';

-- JWT version counter for instant access-token revocation on logout / account disable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "jwt_version" integer NOT NULL DEFAULT 0;
