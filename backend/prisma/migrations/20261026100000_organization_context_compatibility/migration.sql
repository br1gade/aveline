-- Compatibility release: retain organization_memberships_userId_key until
-- every deployed reader/writer has been audited and old runtimes excluded.
SET lock_timeout = '5s';
SET statement_timeout = '30s';
ALTER TABLE organizations ADD COLUMN "accessRevision" INTEGER;
UPDATE organizations SET "accessRevision" = 0 WHERE "accessRevision" IS NULL;
ALTER TABLE organizations ALTER COLUMN "accessRevision" SET DEFAULT 0;
ALTER TABLE organizations ALTER COLUMN "accessRevision" SET NOT NULL;
ALTER TABLE organization_invites ADD COLUMN "acceptedByUserId" TEXT;
ALTER TABLE event_invites ADD COLUMN "acceptedByUserId" TEXT;
CREATE INDEX "organization_memberships_organizationId_role_userId_idx" ON organization_memberships ("organizationId",role,"userId");
CREATE INDEX "organization_memberships_userId_createdAt_id_idx" ON organization_memberships ("userId","createdAt",id);
CREATE TABLE runtime_compatibility (id TEXT PRIMARY KEY, "minimumRevision" INTEGER NOT NULL DEFAULT 2, "multiOrganizationWrites" BOOLEAN NOT NULL DEFAULT false);
INSERT INTO runtime_compatibility(id) VALUES ('organization-context');
CREATE TABLE organization_create_intents (id TEXT PRIMARY KEY, "actorUserId" TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT, key TEXT NOT NULL, fingerprint TEXT NOT NULL, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE UNIQUE INDEX "organization_create_intents_actorUserId_key_key" ON organization_create_intents("actorUserId",key);
CREATE TABLE organization_access_reviews (id TEXT PRIMARY KEY, "organizationId" TEXT NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT, status TEXT NOT NULL DEFAULT 'OPEN', revision INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL, "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "resolvedAt" TIMESTAMP(3), "resolvedByUserId" TEXT);
CREATE UNIQUE INDEX "organization_access_reviews_organizationId_key" ON organization_access_reviews("organizationId");
CREATE INDEX "organization_access_reviews_status_openedAt_id_idx" ON organization_access_reviews(status,"openedAt",id);
