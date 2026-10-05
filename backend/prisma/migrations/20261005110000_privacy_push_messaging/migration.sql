-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('OUTBOUND', 'INBOUND');

-- CreateEnum
CREATE TYPE "DataSubjectRequestKind" AS ENUM ('EXPORT', 'ERASURE', 'RECTIFICATION');

-- CreateEnum
CREATE TYPE "DataSubjectRequestStatus" AS ENUM ('RECEIVED', 'VERIFYING', 'IN_PROGRESS', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('IOS', 'ANDROID', 'WEB');

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "direction" "MessageDirection" NOT NULL DEFAULT 'OUTBOUND',
ADD COLUMN     "threadKey" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "data_subject_requests" (
    "id" TEXT NOT NULL,
    "kind" "DataSubjectRequestKind" NOT NULL,
    "status" "DataSubjectRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "subjectEmail" TEXT NOT NULL,
    "organizationId" TEXT,
    "guestId" TEXT,
    "userId" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "resultAssetId" TEXT,
    "handledByUserId" TEXT,
    "notes" TEXT,

    CONSTRAINT "data_subject_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "guestId" TEXT,
    "platform" "DevicePlatform" NOT NULL,
    "token" TEXT NOT NULL,
    "appVersion" TEXT,
    "locale" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_subject_requests_status_dueAt_idx" ON "data_subject_requests"("status", "dueAt");

-- CreateIndex
CREATE INDEX "data_subject_requests_subjectEmail_idx" ON "data_subject_requests"("subjectEmail");

-- CreateIndex
CREATE UNIQUE INDEX "device_tokens_token_key" ON "device_tokens"("token");

-- CreateIndex
CREATE INDEX "device_tokens_userId_revokedAt_idx" ON "device_tokens"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "device_tokens_guestId_revokedAt_idx" ON "device_tokens"("guestId", "revokedAt");

-- CreateIndex
CREATE INDEX "messages_threadKey_idx" ON "messages"("threadKey");

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_guestId_fkey" FOREIGN KEY ("guestId") REFERENCES "guests"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A device token belongs to exactly one subject. Both set would deliver an
-- organizer's notification to a guest's phone; neither set is unaddressable.
ALTER TABLE "device_tokens"
  ADD CONSTRAINT "device_tokens_one_subject"
  CHECK (("userId" IS NULL) <> ("guestId" IS NULL));

-- The response clock cannot run backwards.
ALTER TABLE "data_subject_requests"
  ADD CONSTRAINT "data_subject_requests_due_after_request"
  CHECK ("dueAt" >= "requestedAt");
