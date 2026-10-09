-- Running-order entries for the people running the day, hidden from guests.
-- A column with a default: existing entries stay visible, as they were.

-- AlterTable
ALTER TABLE "timeline_entries" ADD COLUMN     "isInternal" BOOLEAN NOT NULL DEFAULT false;

