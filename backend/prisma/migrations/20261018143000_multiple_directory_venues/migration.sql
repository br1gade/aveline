-- DropIndex
DROP INDEX "venue_profiles_vendorId_key";

-- CreateIndex
CREATE INDEX "venue_profiles_vendorId_idx" ON "venue_profiles"("vendorId");

