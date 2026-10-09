-- How the built-in RSVP questions are asked. Empty by default: every invitation
-- keeps asking all of them as free text, as before.

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "rsvpFields" JSONB NOT NULL DEFAULT '{}';

