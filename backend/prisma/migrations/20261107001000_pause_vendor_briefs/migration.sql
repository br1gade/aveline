-- Existing bookings keep their link state. Fill the nullable column before constraining it.
ALTER TABLE "vendor_bookings" ADD COLUMN "isBriefEnabled" BOOLEAN DEFAULT true;
UPDATE "vendor_bookings" SET "isBriefEnabled" = true WHERE "isBriefEnabled" IS NULL;
ALTER TABLE "vendor_bookings" ALTER COLUMN "isBriefEnabled" SET NOT NULL;
