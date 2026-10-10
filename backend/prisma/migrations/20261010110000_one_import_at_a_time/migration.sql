-- One guest import of an event runs at a time (B77). Two at once — a double
-- upload, a client retry — each found no household by name and created one,
-- duplicating the guest list. Partial, so finished imports are unaffected.
-- Any run already stuck in PROCESSING is closed first, or the index would
-- refuse to build.
UPDATE "guest_imports" SET "status" = 'FAILED', "finishedAt" = now()
 WHERE "status" = 'PROCESSING';

CREATE UNIQUE INDEX "guest_imports_one_running_per_event"
    ON "guest_imports"("eventId") WHERE "status" = 'PROCESSING';
