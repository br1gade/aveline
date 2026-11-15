-- The session retention sweep deletes by expiry and clears by revocation
-- (src/infra/auth/session-retention.ts).
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");
CREATE INDEX "sessions_revokedAt_idx" ON "sessions"("revokedAt");
