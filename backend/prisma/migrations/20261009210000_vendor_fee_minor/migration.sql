-- Vendor fees in integer minor units, like all money in Aveline (B51).
ALTER TABLE "vendor_bookings" ADD COLUMN "feeMinor" BIGINT;

-- AMD has no subunit; the others in use have two.
UPDATE "vendor_bookings"
   SET "feeMinor" = ROUND("feeAmount" * CASE WHEN upper("feeCurrency") = 'AMD' THEN 1 ELSE 100 END)::BIGINT
 WHERE "feeAmount" IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "vendor_bookings" WHERE "feeAmount" IS NOT NULL AND "feeMinor" IS NULL) THEN
    RAISE EXCEPTION 'a vendor fee was not carried over; refusing to drop feeAmount';
  END IF;
END $$;

ALTER TABLE "vendor_bookings" DROP COLUMN "feeAmount";
