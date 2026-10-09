-- The plan an invoice buys, applied only when it is paid (B39). Nullable: an
-- invoice for something other than a plan has none.
ALTER TABLE "invoices" ADD COLUMN "planId" TEXT;

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_planId_fkey" FOREIGN KEY ("planId") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing invoices name their plan in the line they were issued with — the
-- document, not the subscription row, which a later change overwrote.
UPDATE "invoices" i
   SET "planId" = p.id
  FROM "plans" p
 WHERE p.key = i.lines -> 0 ->> 'planKey'
   AND i."planId" IS NULL;
