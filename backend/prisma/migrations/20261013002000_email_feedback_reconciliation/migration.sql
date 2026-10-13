-- AlterTable
ALTER TABLE "email_feedback" ADD COLUMN     "lastCheckedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "email_feedback_processedAt_lastCheckedAt_receivedAt_idx" ON "email_feedback"("processedAt", "lastCheckedAt", "receivedAt");

