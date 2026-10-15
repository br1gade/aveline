BEGIN;
-- Never assign a guessed event to an old link; report inconsistent historical rows.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM tickets t JOIN guests g ON g.id = t."guestId" WHERE t."eventId" <> g."eventId") THEN
    RAISE EXCEPTION 'Ticket/guest event mismatch; reconcile legacy links before migrating';
  END IF;
END $$;
-- DropForeignKey
ALTER TABLE "tickets" DROP CONSTRAINT "tickets_guestId_fkey";

-- AlterTable
ALTER TABLE "ticket_orders" ADD COLUMN     "cancellationStartedAt" TIMESTAMP(3),
ADD COLUMN     "requestFingerprint" TEXT;

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "attendeeId" TEXT;

-- CreateTable
CREATE TABLE "order_attendees" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ticketTypeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "locale" TEXT NOT NULL,
    "householdKey" TEXT,
    "generatedGuestId" TEXT,
    "linkedSourceSnapshot" JSONB,
    "dietary" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dietaryNotes" TEXT,
    "drinkPreference" TEXT,
    "answers" JSONB NOT NULL DEFAULT '[]',
    "attendanceRevision" INTEGER NOT NULL,
    "status" "RsvpStatus" NOT NULL,
    "venueAttendance" JSONB NOT NULL DEFAULT '[]',
    "erasedAt" TIMESTAMP(3),

    CONSTRAINT "order_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_attendees_generatedGuestId_key" ON "order_attendees"("generatedGuestId");

-- CreateIndex
CREATE INDEX "order_attendees_ticketTypeId_idx" ON "order_attendees"("ticketTypeId");

-- CreateIndex
CREATE INDEX "order_attendees_email_idx" ON "order_attendees"("email");

-- CreateIndex
CREATE INDEX "order_attendees_eventId_idx" ON "order_attendees"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "order_attendees_id_eventId_key" ON "order_attendees"("id", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "order_attendees_orderId_position_key" ON "order_attendees"("orderId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_types_id_eventId_key" ON "ticket_types"("id", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_orders_id_eventId_key" ON "ticket_orders"("id", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_attendeeId_key" ON "tickets"("attendeeId");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_guestId_eventId_key" ON "tickets"("guestId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "tickets_attendeeId_eventId_key" ON "tickets"("attendeeId", "eventId");

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_guestId_eventId_fkey" FOREIGN KEY ("guestId", "eventId") REFERENCES "guests"("id", "eventId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_attendeeId_eventId_fkey" FOREIGN KEY ("attendeeId", "eventId") REFERENCES "order_attendees"("id", "eventId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_attendees" ADD CONSTRAINT "order_attendees_orderId_eventId_fkey" FOREIGN KEY ("orderId", "eventId") REFERENCES "ticket_orders"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_attendees" ADD CONSTRAINT "order_attendees_ticketTypeId_eventId_fkey" FOREIGN KEY ("ticketTypeId", "eventId") REFERENCES "ticket_types"("id", "eventId") ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE FUNCTION guard_ticket_attendee_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."attendeeId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM order_attendees a
    WHERE a.id = NEW."attendeeId" AND a."orderId" = NEW."orderId" AND a."ticketTypeId" = NEW."ticketTypeId" AND a."eventId" = NEW."eventId") THEN
    RAISE EXCEPTION 'Ticket attendee belongs to another order or type' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER ticket_attendee_scope BEFORE INSERT OR UPDATE ON tickets
FOR EACH ROW EXECUTE FUNCTION guard_ticket_attendee_scope();
ALTER TABLE order_attendees ADD CONSTRAINT attendee_position_positive CHECK (position >= 0);

COMMIT;
