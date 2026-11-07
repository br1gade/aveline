-- AlterTable
ALTER TABLE "order_attendees" ADD COLUMN     "ticketSelection" JSONB;

-- CreateTable
CREATE TABLE "show_ticket_inventory" (
    "eventId" TEXT NOT NULL,
    "venueId" TEXT NOT NULL,
    "layoutVersionId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "show_ticket_inventory_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "show_ticket_sections" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "capacity" INTEGER,
    "quantityClaimed" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "show_ticket_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "show_ticket_offers" (
    "sectionId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,

    CONSTRAINT "show_ticket_offers_pkey" PRIMARY KEY ("sectionId","ticketTypeId")
);

-- CreateTable
CREATE TABLE "show_ticket_seats" (
    "id" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "row" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "isBlocked" BOOLEAN NOT NULL DEFAULT false,
    "orderId" TEXT,

    CONSTRAINT "show_ticket_seats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "show_ticket_inventory_layoutVersionId_idx" ON "show_ticket_inventory"("layoutVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "show_ticket_sections_eventId_key_key" ON "show_ticket_sections"("eventId", "key");

-- CreateIndex
CREATE INDEX "show_ticket_offers_ticketTypeId_idx" ON "show_ticket_offers"("ticketTypeId");

-- CreateIndex
CREATE INDEX "show_ticket_seats_sectionId_position_idx" ON "show_ticket_seats"("sectionId", "position");

-- CreateIndex
CREATE INDEX "show_ticket_seats_orderId_idx" ON "show_ticket_seats"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "show_ticket_seats_sectionId_row_label_key" ON "show_ticket_seats"("sectionId", "row", "label");

-- AddForeignKey
ALTER TABLE "show_ticket_inventory" ADD CONSTRAINT "show_ticket_inventory_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "show_ticket_inventory" ADD CONSTRAINT "show_ticket_inventory_layoutVersionId_fkey" FOREIGN KEY ("layoutVersionId") REFERENCES "venue_ticket_layout_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "show_ticket_sections" ADD CONSTRAINT "show_ticket_sections_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "show_ticket_inventory"("eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "show_ticket_offers" ADD CONSTRAINT "show_ticket_offers_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "show_ticket_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "show_ticket_offers" ADD CONSTRAINT "show_ticket_offers_ticketTypeId_fkey" FOREIGN KEY ("ticketTypeId") REFERENCES "ticket_types"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "show_ticket_seats" ADD CONSTRAINT "show_ticket_seats_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "show_ticket_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "show_ticket_seats" ADD CONSTRAINT "show_ticket_seats_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "ticket_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A numbered section has no capacity counter. Zone claims include held and paid places.
ALTER TABLE "show_ticket_sections" ADD CONSTRAINT "show_ticket_sections_capacity_check"
  CHECK (("capacity" IS NULL AND "quantityClaimed" = 0)
    OR ("capacity" IS NOT NULL AND "capacity" > 0 AND "quantityClaimed" BETWEEN 0 AND "capacity"));

ALTER TABLE "show_ticket_seats" ADD CONSTRAINT "show_ticket_seats_blocked_check"
  CHECK (NOT "isBlocked" OR "orderId" IS NULL);
