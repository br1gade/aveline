-- Three access rules the database now holds, so concurrent requests cannot get
-- round them. Each refuses to run rather than discard data that breaks it.

-- 1. A vendor belongs to the organization that added it; null is Aveline's
--    curated list. Existing vendors were visible to everyone, so they become
--    the curated list — which is what they already were in practice.
ALTER TABLE "vendors" ADD COLUMN "organizationId" TEXT;
CREATE INDEX "vendors_organizationId_idx" ON "vendors"("organizationId");
ALTER TABLE "vendors" ADD CONSTRAINT "vendors_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2. One organization per account.
DO $$
BEGIN
  IF EXISTS (SELECT "userId" FROM "organization_memberships" GROUP BY "userId" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'An account belongs to more than one organization; resolve that before applying this migration';
  END IF;
END $$;
CREATE UNIQUE INDEX "organization_memberships_userId_key" ON "organization_memberships"("userId");

-- 3. One account per email address, whatever its capitals. Stored addresses
--    are lower-cased first; two accounts that differ only in case refuse.
DO $$
BEGIN
  IF EXISTS (SELECT lower(email) FROM "users" GROUP BY lower(email) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Two accounts share an email address apart from its capitals; merge them before applying this migration';
  END IF;
END $$;
UPDATE "users" SET "email" = lower("email") WHERE "email" <> lower("email");
CREATE UNIQUE INDEX "users_email_lower_key" ON "users"(lower("email"));
