SET lock_timeout = '5s';
SET statement_timeout = '30s';
ALTER TABLE organization_invites ADD CONSTRAINT "organization_invites_acceptedByUserId_fkey"
  FOREIGN KEY ("acceptedByUserId") REFERENCES users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE organization_invites VALIDATE CONSTRAINT "organization_invites_acceptedByUserId_fkey";
ALTER TABLE event_invites ADD CONSTRAINT "event_invites_acceptedByUserId_fkey"
  FOREIGN KEY ("acceptedByUserId") REFERENCES users(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE event_invites VALIDATE CONSTRAINT "event_invites_acceptedByUserId_fkey";
CREATE TABLE organization_access_changes (
  id TEXT PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  "actorUserId" TEXT REFERENCES users(id) ON DELETE SET NULL,
  "subjectUserId" TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('CREATED','JOINED','ROLE_CHANGED','REMOVED','LEFT','REVIEW_HANDOVER','REVIEW_CLOSE','REVIEW_DECLINE')),
  "previousRole" "OrganizationRole",
  role "OrganizationRole",
  "accessRevision" INTEGER NOT NULL CHECK ("accessRevision" >= 0),
  "revokedEventRoles" INTEGER NOT NULL DEFAULT 0 CHECK ("revokedEventRoles" >= 0),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "organization_access_changes_organizationId_accessRevision_idx" ON organization_access_changes("organizationId","accessRevision");
