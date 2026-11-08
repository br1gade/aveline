ALTER TABLE "subscriptions"
  ADD COLUMN "pendingFreeAt" TIMESTAMP(3),
  ADD COLUMN "pendingFreePlanId" TEXT,
  ADD COLUMN "pendingFreeTerms" JSONB,
  ADD COLUMN "activeFreeTerms" JSONB;

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pendingFreePlanId_fkey"
  FOREIGN KEY ("pendingFreePlanId") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "subscriptions_pendingFreeAt_idx" ON "subscriptions"("pendingFreeAt");
CREATE INDEX "subscriptions_pendingFreePlanId_idx" ON "subscriptions"("pendingFreePlanId");
