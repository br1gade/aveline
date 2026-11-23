-- A bank order may authorize only one financial attempt. Never guess which
-- historical row owns a duplicated reference or silently discard its audit trail.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "payments"
    WHERE "providerRef" IS NOT NULL
    GROUP BY "provider", "providerRef"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Payment provider references are duplicated; reconcile the affected attempts against bank evidence before retrying this migration';
  END IF;
END $$;

CREATE UNIQUE INDEX "payments_provider_providerRef_key"
ON "payments" ("provider", "providerRef");
