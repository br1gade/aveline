-- Remembers what an event was before it was archived. Nullable: no backfill.

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "statusBeforeArchive" "EventStatus";

