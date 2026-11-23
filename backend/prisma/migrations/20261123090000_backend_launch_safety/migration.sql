-- Financial attempts keep their intent even when a later retry changes its pointer.
ALTER TABLE "payments" ADD COLUMN "invoiceId" TEXT,
ADD COLUMN "outcomeUnknownAt" TIMESTAMP(3),
ADD COLUMN "registrationStartedAt" TIMESTAMP(3),
ADD COLUMN "ticketOrderId" TEXT;

ALTER TABLE "plans" ADD COLUMN "translations" JSONB;
UPDATE "plans" SET "translations" = '{}' WHERE "translations" IS NULL;
ALTER TABLE "plans" ALTER COLUMN "translations" SET DEFAULT '{}',
ALTER COLUMN "translations" SET NOT NULL;

-- Historical financial documents have no inferred personal notification recipient.
ALTER TABLE "invoices" ADD COLUMN "paymentNoticeLocale" TEXT,
ADD COLUMN "requestedByUserId" TEXT;

CREATE INDEX "organizations_deletedAt_createdAt_id_idx" ON "organizations"("deletedAt", "createdAt" DESC, "id" DESC);
CREATE INDEX "payments_invoiceId_status_idx" ON "payments"("invoiceId", "status");
CREATE INDEX "payments_ticketOrderId_status_idx" ON "payments"("ticketOrderId", "status");
CREATE INDEX "data_subject_requests_dueAt_id_idx" ON "data_subject_requests"("dueAt", "id");
CREATE INDEX "data_subject_requests_completedAt_id_idx" ON "data_subject_requests"("completedAt" DESC, "id" DESC);
CREATE INDEX "invoices_organizationId_createdAt_id_idx" ON "invoices"("organizationId", "createdAt" DESC, "id" DESC);
CREATE INDEX "invoices_requestedByUserId_idx" ON "invoices"("requestedByUserId");

ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_ticketOrderId_fkey" FOREIGN KEY ("ticketOrderId") REFERENCES "ticket_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_one_purchase_check" CHECK (
  ("invoiceId" IS NULL OR ("ticketOrderId" IS NULL AND purpose = 'SUBSCRIPTION'))
  AND ("ticketOrderId" IS NULL OR ("invoiceId" IS NULL AND purpose = 'TICKET'))
);
