-- AlterTable
ALTER TABLE "venues" ADD COLUMN     "ticketLayoutVersionId" TEXT;

-- CreateTable
CREATE TABLE "venue_ticket_layout_versions" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "venue_ticket_layout_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "venue_ticket_layout_versions_profileId_key_version_key" ON "venue_ticket_layout_versions"("profileId", "key", "version");

-- CreateIndex
CREATE INDEX "venues_ticketLayoutVersionId_idx" ON "venues"("ticketLayoutVersionId");

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_ticketLayoutVersionId_fkey" FOREIGN KEY ("ticketLayoutVersionId") REFERENCES "venue_ticket_layout_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_ticket_layout_versions" ADD CONSTRAINT "venue_ticket_layout_versions_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "venue_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
