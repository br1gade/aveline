-- Session generations (B75): a password reset or "sign out everywhere" moves
-- the account on, and every session and access token from before is refused
-- at once. Constant defaults, so existing rows are generation 0, matching.
ALTER TABLE "sessions" ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "sessionGeneration" INTEGER NOT NULL DEFAULT 0;
