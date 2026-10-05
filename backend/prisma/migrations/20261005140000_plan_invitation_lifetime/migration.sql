-- AlterTable
ALTER TABLE "plans" ADD COLUMN     "invitationLifetimeDays" INTEGER;


-- A lifetime of zero or less would expire an invitation the moment it is
-- published. Null is the way to say "never expires".
ALTER TABLE "plans"
  ADD CONSTRAINT "plans_invitation_lifetime_positive"
  CHECK ("invitationLifetimeDays" IS NULL OR "invitationLifetimeDays" > 0);
