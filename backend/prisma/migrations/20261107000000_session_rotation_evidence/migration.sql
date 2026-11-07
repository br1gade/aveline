-- Existing revocations do not establish that a replacement token was issued.
-- Keep legacy evidence unknown rather than manufacturing a rotation history.
ALTER TABLE "sessions" ADD COLUMN "rotatedAt" TIMESTAMP(3);
