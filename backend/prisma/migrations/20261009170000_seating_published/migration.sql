-- When the host let guests see their tables (decision D4). Nullable: every
-- existing event starts unpublished, which is the safe side — a guest is never
-- shown a plan the host did not mean to share.
ALTER TABLE "events" ADD COLUMN "seatingPublishedAt" TIMESTAMP(3);
