-- Priority in the outbox (B80): account, ticket and confirmation mail ahead of
-- a bulk send. A constant default, so adding it to a populated table is a
-- catalogue change, not a rewrite.
ALTER TABLE "messages" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0;

-- Messages still waiting get the priority they would be given now.
UPDATE "messages" SET "priority" = 10
 WHERE "status" = 'QUEUED'
   AND ("templateKey" LIKE 'account.%' OR "templateKey" LIKE 'ticket.%'
        OR "templateKey" LIKE 'rsvp.confirmation.%'
        OR "templateKey" IN ('organization.invite', 'event.invite'));

DROP INDEX "messages_status_scheduledFor_idx";
CREATE INDEX "messages_status_priority_scheduledFor_idx" ON "messages"("status", "priority", "scheduledFor");

-- Who was invited or reminded, per guest: the reminder sweep, delivery
-- report and erasure all ask it, and it was a scan of every message.
CREATE INDEX "messages_guestId_templateKey_idx" ON "messages"("guestId", "templateKey");
