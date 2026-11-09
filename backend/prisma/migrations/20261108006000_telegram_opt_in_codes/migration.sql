ALTER TABLE "messages"
  ADD COLUMN "telegramOptInDigest" TEXT,
  ADD COLUMN "telegramOptInBinding" TEXT,
  ADD COLUMN "telegramOptInExpiresAt" TIMESTAMP(3),
  ADD COLUMN "telegramOptInRedeemedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "messages_telegramOptInDigest_key" ON "messages"("telegramOptInDigest");
