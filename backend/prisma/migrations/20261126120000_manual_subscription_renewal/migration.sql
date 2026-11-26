-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('PURCHASE', 'RENEWAL');

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "billingAnchorAt" TIMESTAMP(3),
ADD COLUMN     "currentPeriodInvoiceId" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "intervalSnapshot" "BillingInterval",
ADD COLUMN     "kind" "InvoiceKind",
ADD COLUMN     "periodEnd" TIMESTAMP(3),
ADD COLUMN     "periodStart" TIMESTAMP(3),
ADD COLUMN     "renewalAnchorEnd" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "runtime_compatibility" ALTER COLUMN "minimumRevision" SET DEFAULT 5;

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_currentPeriodInvoiceId_key" ON "subscriptions"("currentPeriodInvoiceId");

-- CreateIndex
CREATE INDEX "invoices_subscriptionId_kind_status_periodStart_idx" ON "invoices"("subscriptionId", "kind", "status", "periodStart");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_currentPeriodInvoiceId_fkey" FOREIGN KEY ("currentPeriodInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Existing invoices remain ordinary purchases; never infer historical renewal coverage.
UPDATE invoices SET kind = 'PURCHASE' WHERE kind IS NULL;
ALTER TABLE invoices ALTER COLUMN kind SET DEFAULT 'PURCHASE', ALTER COLUMN kind SET NOT NULL;
CREATE UNIQUE INDEX invoices_live_renewal_anchor_key ON invoices ("subscriptionId", "renewalAnchorEnd")
WHERE kind = 'RENEWAL' AND status IN ('ISSUED', 'PAID');
ALTER TABLE invoices ADD CONSTRAINT invoices_renewal_terms_check CHECK
  (kind <> 'RENEWAL' OR ("subscriptionId" IS NOT NULL AND "renewalAnchorEnd" IS NOT NULL AND "intervalSnapshot" IS NOT NULL));
UPDATE runtime_compatibility SET "minimumRevision" = GREATEST("minimumRevision", 5) WHERE id = 'organization-context';
