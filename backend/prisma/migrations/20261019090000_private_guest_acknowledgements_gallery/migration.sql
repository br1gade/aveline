-- CreateEnum
CREATE TYPE "AcknowledgementMethod" AS ENUM ('TYPED', 'DRAWN');

-- CreateEnum
CREATE TYPE "GuestMediaKind" AS ENUM ('SIGNATURE', 'GALLERY');

-- CreateEnum
CREATE TYPE "GuestMediaStatus" AS ENUM ('STAGING', 'QUEUED', 'PROCESSING', 'READY', 'FAILED', 'REMOVED');

-- CreateEnum
CREATE TYPE "GalleryModerationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- AlterTable
ALTER TABLE "rsvp_questions" ADD COLUMN     "statementVersionId" TEXT;

-- CreateTable
CREATE TABLE "question_statements" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "prompt" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "question_statements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_acknowledgements" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "statementVersionId" TEXT NOT NULL,
    "subjectGuestId" TEXT NOT NULL,
    "signerGuestId" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "method" "AcknowledgementMethod" NOT NULL,
    "isRepresentative" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "mediaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guest_media" (
    "id" TEXT NOT NULL,
    "eventId" TEXT,
    "uploaderGuestId" TEXT,
    "kind" "GuestMediaKind" NOT NULL,
    "processingStatus" "GuestMediaStatus" NOT NULL DEFAULT 'STAGING',
    "moderationStatus" "GalleryModerationStatus" NOT NULL DEFAULT 'PENDING',
    "sourceKey" TEXT NOT NULL,
    "displayKey" TEXT,
    "thumbnailKey" TEXT,
    "mimeType" TEXT NOT NULL,
    "sourceBytes" INTEGER NOT NULL,
    "storedBytes" INTEGER NOT NULL,
    "reservedBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "caption" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "claimToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "failureReason" TEXT,
    "moderatedBy" TEXT,
    "moderatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),
    "clearedAt" TIMESTAMP(3),
    "cleanupAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guest_media_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "question_statements_questionId_revision_key" ON "question_statements"("questionId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "guest_acknowledgements_dedupeKey_key" ON "guest_acknowledgements"("dedupeKey");

-- CreateIndex
CREATE INDEX "guest_acknowledgements_eventId_createdAt_id_idx" ON "guest_acknowledgements"("eventId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "guest_acknowledgements_subjectGuestId_statementVersionId_idx" ON "guest_acknowledgements"("subjectGuestId", "statementVersionId");

-- CreateIndex
CREATE INDEX "guest_acknowledgements_signerGuestId_idx" ON "guest_acknowledgements"("signerGuestId");

-- CreateIndex
CREATE INDEX "guest_acknowledgements_questionId_idx" ON "guest_acknowledgements"("questionId");

-- CreateIndex
CREATE INDEX "guest_acknowledgements_statementVersionId_idx" ON "guest_acknowledgements"("statementVersionId");

-- CreateIndex
CREATE INDEX "guest_acknowledgements_mediaId_idx" ON "guest_acknowledgements"("mediaId");

-- CreateIndex
CREATE UNIQUE INDEX "guest_media_sourceKey_key" ON "guest_media"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "guest_media_displayKey_key" ON "guest_media"("displayKey");

-- CreateIndex
CREATE UNIQUE INDEX "guest_media_thumbnailKey_key" ON "guest_media"("thumbnailKey");

-- CreateIndex
CREATE INDEX "guest_media_eventId_kind_processingStatus_createdAt_id_idx" ON "guest_media"("eventId", "kind", "processingStatus", "createdAt", "id");

-- CreateIndex
CREATE INDEX "guest_media_uploaderGuestId_kind_createdAt_idx" ON "guest_media"("uploaderGuestId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "guest_media_processingStatus_leaseUntil_createdAt_idx" ON "guest_media"("processingStatus", "leaseUntil", "createdAt");

-- CreateIndex
CREATE INDEX "guest_media_cleanupAfter_idx" ON "guest_media"("cleanupAfter");

-- CreateIndex
CREATE UNIQUE INDEX "rsvp_questions_statementVersionId_key" ON "rsvp_questions"("statementVersionId");

-- AddForeignKey
ALTER TABLE "rsvp_questions" ADD CONSTRAINT "rsvp_questions_statementVersionId_fkey" FOREIGN KEY ("statementVersionId") REFERENCES "question_statements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_statements" ADD CONSTRAINT "question_statements_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "rsvp_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_acknowledgements" ADD CONSTRAINT "guest_acknowledgements_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_acknowledgements" ADD CONSTRAINT "guest_acknowledgements_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "rsvp_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_acknowledgements" ADD CONSTRAINT "guest_acknowledgements_statementVersionId_fkey" FOREIGN KEY ("statementVersionId") REFERENCES "question_statements"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_acknowledgements" ADD CONSTRAINT "guest_acknowledgements_subjectGuestId_fkey" FOREIGN KEY ("subjectGuestId") REFERENCES "guests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_acknowledgements" ADD CONSTRAINT "guest_acknowledgements_signerGuestId_fkey" FOREIGN KEY ("signerGuestId") REFERENCES "guests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_acknowledgements" ADD CONSTRAINT "guest_acknowledgements_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "guest_media"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_media" ADD CONSTRAINT "guest_media_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guest_media" ADD CONSTRAINT "guest_media_uploaderGuestId_fkey" FOREIGN KEY ("uploaderGuestId") REFERENCES "guests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

