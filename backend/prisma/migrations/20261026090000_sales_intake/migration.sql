-- CreateEnum
CREATE TYPE "EnquiryStage" AS ENUM ('NEW', 'CONTACTED', 'CONSULTATION', 'READY_FOR_QUOTE', 'CLOSED');

-- CreateEnum
CREATE TYPE "EnquirySource" AS ENUM ('PHONE', 'MESSAGING', 'IN_PERSON', 'EMAIL', 'OTHER');

-- CreateEnum
CREATE TYPE "EnquiryClosureReason" AS ENUM ('CUSTOMER_DECLINED', 'UNREACHABLE', 'DUPLICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "EnquiryClearanceReason" AS ENUM ('RETENTION', 'VERIFIED_ERASURE');

-- CreateEnum
CREATE TYPE "EnquiryAddressKind" AS ENUM ('EMAIL', 'PHONE');

-- CreateEnum
CREATE TYPE "EnquiryNoteKind" AS ENUM ('GENERAL', 'CONSULTATION');

-- CreateEnum
CREATE TYPE "ConsultationStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OwnerInviteDeliveryState" AS ENUM ('PENDING', 'QUEUED', 'CANCELLED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "DataSubjectSource" AS ENUM ('EMAIL', 'STAFF_ENQUIRY');

-- AlterTable
ALTER TABLE "data_subject_requests" ADD COLUMN     "enquirySubjectsVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "erasureAppliedAt" TIMESTAMP(3),
ADD COLUMN     "erasureCheckpointId" TEXT,
ADD COLUMN     "erasureResult" JSONB,
ADD COLUMN     "subjectSource" "DataSubjectSource" NOT NULL DEFAULT 'EMAIL',
ALTER COLUMN "subjectEmail" DROP NOT NULL;

-- CreateTable
CREATE TABLE "sales_enquiries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "eventId" TEXT,
    "assignedUserId" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "stage" "EnquiryStage" NOT NULL DEFAULT 'NEW',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "eventType" "EventType",
    "approximateLocalDate" DATE,
    "approximateTimezone" VARCHAR(64),
    "estimatedGuestCount" INTEGER,
    "preferredLocale" VARCHAR(2),
    "source" "EnquirySource",
    "closedAt" TIMESTAMP(3),
    "closureReason" "EnquiryClosureReason",
    "closureNote" VARCHAR(2000),
    "cleanupDueAt" TIMESTAMP(3),
    "personalDataClearedAt" TIMESTAMP(3),
    "clearanceReason" "EnquiryClearanceReason",
    "privacyRevision" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiry_contacts" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "name" VARCHAR(200),
    "email" VARCHAR(200),
    "phone" VARCHAR(32),
    "redactedAt" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "enquiry_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiry_contact_addresses" (
    "contactId" TEXT NOT NULL,
    "kind" "EnquiryAddressKind" NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enquiry_contact_addresses_pkey" PRIMARY KEY ("contactId","kind","fingerprint")
);

-- CreateTable
CREATE TABLE "enquiry_notes" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "kind" "EnquiryNoteKind" NOT NULL DEFAULT 'GENERAL',
    "consultationId" TEXT,
    "body" VARCHAR(10000),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redactedAt" TIMESTAMP(3),

    CONSTRAINT "enquiry_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultations" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "operatorUserId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL,
    "status" "ConsultationStatus" NOT NULL DEFAULT 'SCHEDULED',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consultations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiry_activities" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "enquiryRevision" INTEGER NOT NULL,
    "actorUserId" TEXT,
    "kind" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enquiry_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiry_commands" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "idempotencyKey" VARCHAR(128) NOT NULL,
    "requestFingerprint" TEXT,
    "enquiryId" TEXT,
    "resultId" TEXT,
    "appliedRevision" INTEGER NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invalidatedAt" TIMESTAMP(3),

    CONSTRAINT "enquiry_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiry_conversions" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT,
    "ownerInviteId" TEXT,
    "convertedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "enquiry_conversions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_invite_deliveries" (
    "id" TEXT NOT NULL,
    "organizationInviteId" TEXT NOT NULL,
    "enquiryId" TEXT,
    "privacyRevision" INTEGER NOT NULL,
    "sourceContactId" TEXT,
    "state" "OwnerInviteDeliveryState" NOT NULL DEFAULT 'PENDING',
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "owner_invite_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiry_privacy_fences" (
    "id" TEXT NOT NULL DEFAULT 'intake',
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "enquiry_privacy_fences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiry_erasure_tombstones" (
    "enquiryId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "privacyRevision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceRequestId" TEXT,

    CONSTRAINT "enquiry_erasure_tombstones_pkey" PRIMARY KEY ("enquiryId","contactId")
);

-- CreateTable
CREATE TABLE "enquiry_privacy_redactions" (
    "id" TEXT NOT NULL,
    "enquiryId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "reason" "EnquiryClearanceReason" NOT NULL,
    "privacyRevision" INTEGER NOT NULL,
    "redactedAt" TIMESTAMP(3) NOT NULL,
    "checkpointSequence" BIGINT,
    "checkpointedAt" TIMESTAMP(3),

    CONSTRAINT "enquiry_privacy_redactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_subject_request_enquiry_subjects" (
    "requestId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,

    CONSTRAINT "data_subject_request_enquiry_subjects_pkey" PRIMARY KEY ("requestId","contactId")
);

-- CreateIndex
CREATE INDEX "sales_enquiries_assignedUserId_createdAt_id_idx" ON "sales_enquiries"("assignedUserId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "sales_enquiries_createdAt_id_idx" ON "sales_enquiries"("createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "enquiry_contacts_enquiryId_key" ON "enquiry_contacts"("enquiryId");

-- CreateIndex
CREATE INDEX "enquiry_contact_addresses_kind_fingerprint_contactId_idx" ON "enquiry_contact_addresses"("kind", "fingerprint", "contactId");

-- CreateIndex
CREATE INDEX "enquiry_notes_enquiryId_createdAt_id_idx" ON "enquiry_notes"("enquiryId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "consultations_enquiryId_startsAt_id_idx" ON "consultations"("enquiryId", "startsAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "consultations_id_enquiryId_key" ON "consultations"("id", "enquiryId");

-- CreateIndex
CREATE INDEX "enquiry_activities_enquiryId_enquiryRevision_idx" ON "enquiry_activities"("enquiryId", "enquiryRevision" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "enquiry_activities_enquiryId_enquiryRevision_key" ON "enquiry_activities"("enquiryId", "enquiryRevision");

-- CreateIndex
CREATE UNIQUE INDEX "enquiry_commands_actorUserId_operation_idempotencyKey_key" ON "enquiry_commands"("actorUserId", "operation", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "enquiry_conversions_enquiryId_key" ON "enquiry_conversions"("enquiryId");

-- CreateIndex
CREATE UNIQUE INDEX "owner_invite_deliveries_organizationInviteId_key" ON "owner_invite_deliveries"("organizationInviteId");

-- CreateIndex
CREATE INDEX "owner_invite_deliveries_state_createdAt_idx" ON "owner_invite_deliveries"("state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "enquiry_privacy_redactions_checkpointSequence_key" ON "enquiry_privacy_redactions"("checkpointSequence");

-- CreateIndex
CREATE INDEX "enquiry_privacy_redactions_checkpointedAt_redactedAt_idx" ON "enquiry_privacy_redactions"("checkpointedAt", "redactedAt");

-- CreateIndex


-- AddForeignKey
ALTER TABLE "sales_enquiries" ADD CONSTRAINT "sales_enquiries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_enquiries" ADD CONSTRAINT "sales_enquiries_eventId_organizationId_fkey" FOREIGN KEY ("eventId", "organizationId") REFERENCES "events"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_enquiries" ADD CONSTRAINT "sales_enquiries_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiry_contacts" ADD CONSTRAINT "enquiry_contacts_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "sales_enquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiry_contact_addresses" ADD CONSTRAINT "enquiry_contact_addresses_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "enquiry_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiry_notes" ADD CONSTRAINT "enquiry_notes_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "sales_enquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiry_notes" ADD CONSTRAINT "enquiry_notes_consultationId_enquiryId_fkey" FOREIGN KEY ("consultationId", "enquiryId") REFERENCES "consultations"("id", "enquiryId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "sales_enquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consultations" ADD CONSTRAINT "consultations_operatorUserId_fkey" FOREIGN KEY ("operatorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiry_activities" ADD CONSTRAINT "enquiry_activities_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "sales_enquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiry_commands" ADD CONSTRAINT "enquiry_commands_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "sales_enquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiry_conversions" ADD CONSTRAINT "enquiry_conversions_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "sales_enquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiry_conversions" ADD CONSTRAINT "enquiry_conversions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enquiry_conversions" ADD CONSTRAINT "enquiry_conversions_eventId_organizationId_fkey" FOREIGN KEY ("eventId", "organizationId") REFERENCES "events"("id", "organizationId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_invite_deliveries" ADD CONSTRAINT "owner_invite_deliveries_enquiryId_fkey" FOREIGN KEY ("enquiryId") REFERENCES "sales_enquiries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_subject_request_enquiry_subjects" ADD CONSTRAINT "data_subject_request_enquiry_subjects_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "data_subject_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_subject_request_enquiry_subjects" ADD CONSTRAINT "data_subject_request_enquiry_subjects_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "enquiry_contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

