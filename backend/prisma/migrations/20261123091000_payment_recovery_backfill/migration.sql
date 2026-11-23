-- An exact owner and matching financial terms are required; prefixes are not authority.
-- Begin legacy payment recovery
DO $$
BEGIN
  WITH candidates AS (
    SELECT p.id AS payment_id, i.id AS invoice_id
      FROM payments p JOIN invoices i ON
        (i."paymentOrderNumber" = p."orderNumber" OR p."idempotencyKey" = 'invoice-' || i.id)
     WHERE p.purpose = 'SUBSCRIPTION' AND p."organizationId" = i."organizationId"
       AND p."amountMinor" = i."totalMinor" AND p.currency = i.currency
  ), unambiguous AS (
    SELECT payment_id, MIN(invoice_id) AS invoice_id FROM candidates
     GROUP BY payment_id HAVING COUNT(DISTINCT invoice_id) = 1
  )
  UPDATE payments p SET "invoiceId" = c.invoice_id
    FROM unambiguous c WHERE p.id = c.payment_id AND p."invoiceId" IS NULL AND p."ticketOrderId" IS NULL;

  WITH RECURSIVE attempts AS (
    SELECT p.id, p."invoiceId", p."orderNumber", ARRAY[p.id] AS visited
      FROM payments p WHERE p."invoiceId" IS NOT NULL
    UNION ALL
    SELECT next.id, previous."invoiceId", next."orderNumber", previous.visited || next.id
      FROM attempts previous JOIN payments next ON
        next."idempotencyKey" = 'invoice-' || previous."invoiceId" || '-after-' || previous."orderNumber"
      JOIN invoices i ON i.id = previous."invoiceId"
     WHERE next.purpose = 'SUBSCRIPTION' AND next."organizationId" = i."organizationId"
       AND next."amountMinor" = i."totalMinor" AND next.currency = i.currency
       AND NOT next.id = ANY(previous.visited)
  ), unambiguous AS (
    SELECT id, MIN("invoiceId") AS invoice_id FROM attempts
     GROUP BY id HAVING COUNT(DISTINCT "invoiceId") = 1
  )
  UPDATE payments p SET "invoiceId" = a.invoice_id
    FROM unambiguous a WHERE p.id = a.id AND p."invoiceId" IS NULL AND p."ticketOrderId" IS NULL;

  WITH candidates AS (
    SELECT p.id AS payment_id, o.id AS order_id FROM payments p JOIN ticket_orders o ON
      (o."paymentOrderNumber" = p."orderNumber" OR p."idempotencyKey" = 'order-' || o.id)
      JOIN events e ON e.id = o."eventId"
     WHERE p.purpose = 'TICKET' AND p."organizationId" = e."organizationId"
       AND p."eventId" = o."eventId" AND p."amountMinor" = o."totalMinor" AND p.currency = o.currency
  ), unambiguous AS (
    SELECT payment_id, MIN(order_id) AS order_id FROM candidates
     GROUP BY payment_id HAVING COUNT(DISTINCT order_id) = 1
  )
  UPDATE payments p SET "ticketOrderId" = c.order_id
    FROM unambiguous c WHERE p.id = c.payment_id AND p."ticketOrderId" IS NULL AND p."invoiceId" IS NULL;

  -- The old code did not record whether an external registration was attempted.
  -- Do not rewrite its status ledger or declare an unknown charge safe to repeat.
  UPDATE payments SET "registrationStartedAt" = "createdAt"
   WHERE "registrationStartedAt" IS NULL;
  UPDATE payments SET "outcomeUnknownAt" = COALESCE("outcomeUnknownAt", CURRENT_TIMESTAMP)
   WHERE status IN ('CREATED', 'FAILED', 'EXPIRED')
      OR (purpose = 'SUBSCRIPTION' AND "invoiceId" IS NULL AND status IN ('PENDING', 'AUTHORIZED', 'CAPTURED'))
      OR (purpose = 'TICKET' AND "ticketOrderId" IS NULL AND status IN ('PENDING', 'AUTHORIZED', 'CAPTURED'));
END $$;
-- End legacy payment recovery
