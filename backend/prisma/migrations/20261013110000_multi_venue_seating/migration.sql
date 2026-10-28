BEGIN;

-- DropForeignKey
ALTER TABLE "tables" DROP CONSTRAINT "tables_venueId_fkey";

-- DropForeignKey
ALTER TABLE "seats" DROP CONSTRAINT "seats_tableId_fkey";

-- DropForeignKey
ALTER TABLE "seats" DROP CONSTRAINT "seats_guestId_fkey";

-- DropIndex
DROP INDEX "tables_eventId_name_key";

-- DropIndex
DROP INDEX "seats_guestId_key";

-- AlterTable
ALTER TABLE "tables" ADD COLUMN     "arrangementId" TEXT DEFAULT NULL::text;

-- AlterTable
ALTER TABLE "seats" ADD COLUMN     "arrangementId" TEXT DEFAULT NULL::text,
ADD COLUMN     "eventId" TEXT DEFAULT NULL::text;

-- CreateTable
CREATE TABLE "seating_arrangements" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "venueId" TEXT,

    CONSTRAINT "seating_arrangements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seat_releases" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "arrangementId" TEXT NOT NULL,
    "tableId" TEXT,
    "releasedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seat_releases_pkey" PRIMARY KEY ("id")
);

-- Never guess venue membership: tables without a venue retain a separate legacy plan.
INSERT INTO seating_arrangements (id, "eventId", "venueId")
SELECT 'legacy:' || id, id, NULL FROM events;
INSERT INTO seating_arrangements (id, "eventId", "venueId")
SELECT 'venue:' || id, "eventId", id FROM venues;
UPDATE tables SET "arrangementId" = CASE
  WHEN "venueId" IS NULL THEN 'legacy:' || "eventId" ELSE 'venue:' || "venueId" END;
UPDATE seats s SET "arrangementId" = t."arrangementId", "eventId" = t."eventId"
FROM tables t WHERE s."tableId" = t.id;

-- Preserve the original release timestamp and any unknown/deleted table as legacy history.
INSERT INTO seat_releases (id, "guestId", "eventId", "arrangementId", "tableId", "releasedAt")
SELECT 'release:' || g.id, g.id, g."eventId", COALESCE(t."arrangementId", 'legacy:' || g."eventId"),
       t.id, g."seatReleasedAt"
FROM guests g LEFT JOIN tables t ON t.id = g."seatReleasedFromTableId" AND t."eventId" = g."eventId"
WHERE g."seatReleasedAt" IS NOT NULL;

ALTER TABLE tables ALTER COLUMN "arrangementId" SET NOT NULL;
ALTER TABLE seats ALTER COLUMN "arrangementId" SET NOT NULL, ALTER COLUMN "eventId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "seating_arrangements_venueId_key" ON "seating_arrangements"("venueId");

-- CreateIndex
CREATE INDEX "seating_arrangements_eventId_idx" ON "seating_arrangements"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "seating_arrangements_id_eventId_key" ON "seating_arrangements"("id", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "seating_arrangements_venueId_eventId_key" ON "seating_arrangements"("venueId", "eventId");

-- CreateIndex
CREATE INDEX "seat_releases_tableId_idx" ON "seat_releases"("tableId");

-- CreateIndex
CREATE INDEX "seat_releases_arrangementId_idx" ON "seat_releases"("arrangementId");

-- CreateIndex
CREATE UNIQUE INDEX "seat_releases_guestId_arrangementId_key" ON "seat_releases"("guestId", "arrangementId");

-- CreateIndex
CREATE UNIQUE INDEX "venues_id_eventId_key" ON "venues"("id", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "guests_id_eventId_key" ON "guests"("id", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "tables_arrangementId_name_key" ON "tables"("arrangementId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "tables_id_arrangementId_eventId_key" ON "tables"("id", "arrangementId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "seats_guestId_arrangementId_key" ON "seats"("guestId", "arrangementId");

-- AddForeignKey
ALTER TABLE "seating_arrangements" ADD CONSTRAINT "seating_arrangements_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seating_arrangements" ADD CONSTRAINT "seating_arrangements_venueId_eventId_fkey" FOREIGN KEY ("venueId", "eventId") REFERENCES "venues"("id", "eventId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_releases" ADD CONSTRAINT "seat_releases_guestId_eventId_fkey" FOREIGN KEY ("guestId", "eventId") REFERENCES "guests"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_releases" ADD CONSTRAINT "seat_releases_arrangementId_eventId_fkey" FOREIGN KEY ("arrangementId", "eventId") REFERENCES "seating_arrangements"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seat_releases" ADD CONSTRAINT "seat_releases_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_venueId_eventId_fkey" FOREIGN KEY ("venueId", "eventId") REFERENCES "venues"("id", "eventId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_arrangementId_eventId_fkey" FOREIGN KEY ("arrangementId", "eventId") REFERENCES "seating_arrangements"("id", "eventId") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seats" ADD CONSTRAINT "seats_tableId_arrangementId_eventId_fkey" FOREIGN KEY ("tableId", "arrangementId", "eventId") REFERENCES "tables"("id", "arrangementId", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seats" ADD CONSTRAINT "seats_guestId_eventId_fkey" FOREIGN KEY ("guestId", "eventId") REFERENCES "guests"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;


-- Prisma cannot describe partial uniqueness or write-derivation triggers. Keep these in migrations.
CREATE UNIQUE INDEX seating_arrangements_legacy_event_key
ON seating_arrangements ("eventId") WHERE "venueId" IS NULL;

CREATE FUNCTION create_event_seating_arrangement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO seating_arrangements (id, "eventId", "venueId") VALUES ('legacy:' || NEW.id, NEW.id, NULL);
  RETURN NEW;
END $$;
CREATE TRIGGER events_seating_arrangement AFTER INSERT ON events
FOR EACH ROW EXECUTE FUNCTION create_event_seating_arrangement();

CREATE FUNCTION create_venue_seating_arrangement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO seating_arrangements (id, "eventId", "venueId") VALUES ('venue:' || NEW.id, NEW."eventId", NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER venues_seating_arrangement AFTER INSERT ON venues
FOR EACH ROW EXECUTE FUNCTION create_venue_seating_arrangement();

-- Omitted derived fields remain supported for existing seed/import/bulk writers.
CREATE FUNCTION derive_table_arrangement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_id text;
BEGIN
  SELECT id INTO expected_id FROM seating_arrangements
  WHERE "eventId" = NEW."eventId" AND "venueId" IS NOT DISTINCT FROM NEW."venueId";
  IF expected_id IS NULL THEN
    RAISE EXCEPTION 'No seating arrangement for this event and venue' USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."venueId" IS DISTINCT FROM OLD."venueId" THEN
    IF EXISTS (SELECT 1 FROM seats WHERE "tableId" = OLD.id)
       OR EXISTS (SELECT 1 FROM seat_releases WHERE "tableId" = OLD.id) THEN
      RAISE EXCEPTION 'Move guests and dismiss release markers before changing venue' USING ERRCODE = '23514';
    END IF;
    NEW."arrangementId" := expected_id;
  END IF;
  IF NEW."arrangementId" IS NOT NULL AND NEW."arrangementId" <> expected_id THEN
    RAISE EXCEPTION 'Table arrangement does not match its venue' USING ERRCODE = '23514';
  END IF;
  NEW."arrangementId" := expected_id;
  RETURN NEW;
END $$;
CREATE TRIGGER tables_seating_arrangement BEFORE INSERT OR UPDATE ON tables
FOR EACH ROW EXECUTE FUNCTION derive_table_arrangement();

CREATE FUNCTION derive_seat_arrangement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target tables%ROWTYPE;
BEGIN
  SELECT * INTO target FROM tables WHERE id = NEW."tableId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such table' USING ERRCODE = '23503';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."tableId" IS DISTINCT FROM OLD."tableId" THEN
    NEW."arrangementId" := target."arrangementId";
    NEW."eventId" := target."eventId";
  END IF;
  IF (NEW."arrangementId" IS NOT NULL AND NEW."arrangementId" <> target."arrangementId")
     OR (NEW."eventId" IS NOT NULL AND NEW."eventId" <> target."eventId") THEN
    RAISE EXCEPTION 'Seat arrangement does not match its table' USING ERRCODE = '23514';
  END IF;
  IF NEW.position IS NOT NULL AND (NEW.position < 1 OR NEW.position > target.capacity) THEN
    RAISE EXCEPTION 'Position is outside table capacity' USING ERRCODE = '23514';
  END IF;
  NEW."arrangementId" := target."arrangementId";
  NEW."eventId" := target."eventId";
  RETURN NEW;
END $$;
CREATE TRIGGER seats_seating_arrangement BEFORE INSERT OR UPDATE ON seats
FOR EACH ROW EXECUTE FUNCTION derive_seat_arrangement();

COMMIT;
