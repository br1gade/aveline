-- CreateEnum
CREATE TYPE "WhatsAppReceiptOutcome" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "WhatsAppDeliveryFailureKind" AS ENUM ('CONFIGURATION', 'TRANSIENT', 'AMBIGUOUS', 'UNKNOWN');

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "deliveryErrorCode" INTEGER,
ADD COLUMN     "deliveryFailedAt" TIMESTAMP(3),
ADD COLUMN     "deliveryFailureKind" "WhatsAppDeliveryFailureKind",
ADD COLUMN     "providerAccountId" TEXT,
ADD COLUMN     "providerSenderId" TEXT,
ADD COLUMN     "providerStatusAt" TIMESTAMP(3),
ADD COLUMN     "readAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "whatsapp_receipts" (
    "receiptKey" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "outcome" "WhatsAppReceiptOutcome" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "errorCode" INTEGER,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "whatsapp_receipts_pkey" PRIMARY KEY ("receiptKey")
);

-- CreateIndex
CREATE INDEX "whatsapp_receipts_processedAt_lastCheckedAt_receivedAt_idx" ON "whatsapp_receipts"("processedAt", "lastCheckedAt", "receivedAt");

-- CreateIndex
CREATE INDEX "whatsapp_receipts_processedAt_receivedAt_idx" ON "whatsapp_receipts"("processedAt", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "messages_channel_providerAccountId_providerSenderId_provide_key" ON "messages"("channel", "providerAccountId", "providerSenderId", "providerRef");

