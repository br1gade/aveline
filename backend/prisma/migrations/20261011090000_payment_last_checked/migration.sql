-- Reconciliation takes the longest-unasked payments first (B85). Nullable,
-- so existing rows need no backfill: never asked sorts first.
ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "lastCheckedAt" TIMESTAMP(3);

DROP INDEX IF EXISTS "payments_status_createdAt_idx";
CREATE INDEX IF NOT EXISTS "payments_status_lastCheckedAt_idx" ON "payments"("status", "lastCheckedAt");
