-- CreateEnum
CREATE TYPE "EmailFeedbackOutcome" AS ENUM ('DELIVERED', 'HARD_BOUNCE', 'SOFT_BOUNCE', 'COMPLAINT');

-- CreateTable
CREATE TABLE "email_feedback" (
    "receiptKey" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "outcome" "EmailFeedbackOutcome" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "email_feedback_pkey" PRIMARY KEY ("receiptKey")
);

-- CreateIndex
CREATE INDEX "email_feedback_processedAt_receivedAt_idx" ON "email_feedback"("processedAt", "receivedAt");

-- CreateIndex
CREATE INDEX "email_feedback_messageId_idx" ON "email_feedback"("messageId");

