-- Gap-free invoice numbering.
--
-- A Postgres sequence is the obvious choice and the wrong one: nextval is
-- non-transactional, so a rolled-back invoice burns its number and leaves a
-- gap in a numbered series. An unexplained gap is what a tax audit asks
-- about, so the counter is an ordinary row incremented inside the same
-- transaction that writes the invoice.
--
-- The cost is that concurrent issuance serialises on this row. That is
-- acceptable: invoices are issued by a renewal sweep and by a handful of
-- manual actions, not by buyers.
CREATE TABLE "invoice_counters" (
    "series" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_counters_pkey" PRIMARY KEY ("series")
);

-- A counter that has gone backwards would reissue a number that is already
-- on a filed document.
ALTER TABLE "invoice_counters"
  ADD CONSTRAINT "invoice_counters_next_positive" CHECK ("next" >= 1);
