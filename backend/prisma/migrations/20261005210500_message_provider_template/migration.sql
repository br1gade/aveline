-- WhatsApp sends registered templates, not text, so a queued message has to
-- carry which template and which parameters it will travel as — resolved at
-- enqueue for the same reason the body is, so a later template edit never
-- changes what a guest already received.
--
-- Safe against a populated table: both are nullable or defaulted, and every
-- existing message keeps sending its rendered body as it is.
ALTER TABLE "messages"
  ADD COLUMN "providerTemplate" TEXT,
  ADD COLUMN "providerParams" TEXT[] DEFAULT ARRAY[]::TEXT[];
