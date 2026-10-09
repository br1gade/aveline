-- A guest who declines gives up their seat, and the plan shows where it was
-- (decided 9 October 2026). Both columns nullable: most guests never decline.
ALTER TABLE "guests" ADD COLUMN "seatReleasedAt" TIMESTAMP(3),
ADD COLUMN "seatReleasedFromTableId" TEXT;

CREATE INDEX "guests_seatReleasedFromTableId_idx" ON "guests"("seatReleasedFromTableId");

ALTER TABLE "guests" ADD CONSTRAINT "guests_seatReleasedFromTableId_fkey" FOREIGN KEY ("seatReleasedFromTableId") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Guests who declined before this rule still hold a seat. Release them the
-- same way the rule now does, flagged, so nothing changes silently.
UPDATE "guests" g
   SET "seatReleasedAt" = now(), "seatReleasedFromTableId" = s."tableId"
  FROM "seats" s, "rsvps" r
 WHERE s."guestId" = g.id AND r."guestId" = g.id AND r.status = 'DECLINED';

DELETE FROM "seats" s
 USING "rsvps" r
 WHERE r."guestId" = s."guestId" AND r.status = 'DECLINED';
