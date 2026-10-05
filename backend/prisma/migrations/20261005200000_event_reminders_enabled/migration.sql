-- Scheduled RSVP reminders write to guests without the host pressing
-- anything, so a host has to be able to refuse them. Safe against a populated
-- table: the column arrives with a default, so existing events keep the
-- behaviour they would have had.
ALTER TABLE "events"
  ADD COLUMN "remindersEnabled" BOOLEAN NOT NULL DEFAULT true;
