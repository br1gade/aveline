-- Indexes for queries that scanned (B91). Additive. On a large live table
-- these would be built CONCURRENTLY, outside a transaction; nothing is live yet.
CREATE INDEX IF NOT EXISTS "invoices_paymentOrderNumber_idx" ON "invoices"("paymentOrderNumber");
CREATE INDEX IF NOT EXISTS "invoices_status_idx" ON "invoices"("status");
CREATE INDEX IF NOT EXISTS "rsvp_answers_questionId_idx" ON "rsvp_answers"("questionId");
CREATE INDEX IF NOT EXISTS "ticket_order_items_ticketTypeId_idx" ON "ticket_order_items"("ticketTypeId");
CREATE INDEX IF NOT EXISTS "ticket_orders_status_updatedAt_idx" ON "ticket_orders"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "tickets_orderId_idx" ON "tickets"("orderId");
