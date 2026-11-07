-- AlterTable
ALTER TABLE "event_listings" ADD COLUMN     "buyerTicketLimit" INTEGER;

ALTER TABLE "event_listings" ADD CONSTRAINT "event_listings_buyer_ticket_limit_range"
  CHECK ("buyerTicketLimit" BETWEEN 1 AND 100000);

-- Prisma cannot declare an expression/partial index. Match the checkout count predicate.
CREATE INDEX "ticket_orders_active_buyer_email_idx"
  ON "ticket_orders" ("eventId", lower(btrim("buyerEmail")))
  WHERE status IN ('RESERVED', 'PAID');
