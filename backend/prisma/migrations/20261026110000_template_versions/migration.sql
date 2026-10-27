-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "designRevision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "templateOwnerScopeKey" TEXT,
ADD COLUMN     "templateVersionId" TEXT;

-- AlterTable
ALTER TABLE "design_templates" ADD COLUMN     "activeVersionId" TEXT,
ADD COLUMN     "nextVersionNumber" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "ownerScopeKey" TEXT NOT NULL DEFAULT 'shared',
ADD COLUMN     "retiredAt" TIMESTAMP(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "design_template_versions" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "ownerScopeKey" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "allowedFonts" TEXT[],
    "palettes" JSONB NOT NULL,
    "supportedBlocks" "BlockType"[],
    "blockVariants" JSONB NOT NULL,
    "defaultTheme" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "rendererKey" TEXT NOT NULL DEFAULT 'invitation-v1',
    "capabilityVersion" TEXT,
    "capabilityDigest" TEXT,
    "assetManifest" JSONB NOT NULL DEFAULT '[]',
    "contentHash" TEXT NOT NULL,
    "hashAlgorithm" TEXT NOT NULL DEFAULT 'CANONICAL_SHA256_V1',
    "provenance" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "publishedByUserId" TEXT,

    CONSTRAINT "design_template_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_drafts" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "ownerScopeKey" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "definition" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_assignments" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedByUserId" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_audits" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_previews" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "draftId" TEXT,
    "invitationId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "targetHash" TEXT NOT NULL,
    "targetVersionId" TEXT,
    "sourceVersionId" TEXT,
    "designRevision" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_previews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_receipts" (
    "id" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "design_template_versions_templateId_versionNumber_key" ON "design_template_versions"("templateId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "design_template_versions_id_templateId_ownerScopeKey_key" ON "design_template_versions"("id", "templateId", "ownerScopeKey");

-- CreateIndex
CREATE INDEX "template_drafts_templateId_state_idx" ON "template_drafts"("templateId", "state");

-- CreateIndex
CREATE INDEX "template_assignments_userId_revokedAt_idx" ON "template_assignments"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "template_assignments_templateId_userId_key" ON "template_assignments"("templateId", "userId");

-- CreateIndex
CREATE INDEX "template_audits_templateId_createdAt_idx" ON "template_audits"("templateId", "createdAt");

-- CreateIndex
CREATE INDEX "template_previews_expiresAt_idx" ON "template_previews"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "template_receipts_scopeKey_idempotencyKey_key" ON "template_receipts"("scopeKey", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "design_templates_activeVersionId_key" ON "design_templates"("activeVersionId");

-- CreateIndex
CREATE INDEX "design_templates_ownerScopeKey_isActive_name_id_idx" ON "design_templates"("ownerScopeKey", "isActive", "name", "id");

-- CreateIndex
CREATE UNIQUE INDEX "design_templates_id_ownerScopeKey_key" ON "design_templates"("id", "ownerScopeKey");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "design_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_templates" ADD CONSTRAINT "design_templates_activeVersionId_fkey" FOREIGN KEY ("activeVersionId") REFERENCES "design_template_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "design_template_versions" ADD CONSTRAINT "design_template_versions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "design_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_drafts" ADD CONSTRAINT "template_drafts_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "design_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_assignments" ADD CONSTRAINT "template_assignments_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "design_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Exact snapshots intentionally preserve nulls, array order and unusual legacy values.
-- No publication actor or time is invented for pre-version data.
CREATE FUNCTION capture_template_baseline() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE version_id text := NEW.id || ':baseline';
BEGIN
  INSERT INTO design_template_versions (id,"templateId","ownerScopeKey","versionNumber",name,"allowedFonts",palettes,"supportedBlocks","blockVariants","defaultTheme","contentHash","hashAlgorithm",provenance)
  VALUES (version_id,NEW.id,NEW."ownerScopeKey",1,NEW.name,NEW."allowedFonts",NEW.palettes,NEW."supportedBlocks",NEW."blockVariants",NEW."defaultTheme",
    encode(sha256(convert_to(jsonb_build_object('name',NEW.name,'allowedFonts',NEW."allowedFonts",'palettes',NEW.palettes,'supportedBlocks',NEW."supportedBlocks",'blockVariants',NEW."blockVariants",'defaultTheme',NEW."defaultTheme")::text,'UTF8')),'hex'),'POSTGRES_JSONB_SHA256_V1','LEGACY_BASELINE');
  UPDATE design_templates SET "activeVersionId" = version_id WHERE id = NEW.id;
  RETURN NEW;
END $$;
CREATE TRIGGER capture_template_baseline AFTER INSERT ON design_templates FOR EACH ROW EXECUTE FUNCTION capture_template_baseline();
INSERT INTO design_template_versions (id,"templateId","ownerScopeKey","versionNumber",name,"allowedFonts",palettes,"supportedBlocks","blockVariants","defaultTheme","contentHash","hashAlgorithm",provenance)
SELECT id || ':baseline',id,"ownerScopeKey",1,name,"allowedFonts",palettes,"supportedBlocks","blockVariants","defaultTheme",
 encode(sha256(convert_to(jsonb_build_object('name',name,'allowedFonts',"allowedFonts",'palettes',palettes,'supportedBlocks',"supportedBlocks",'blockVariants',"blockVariants",'defaultTheme',"defaultTheme")::text,'UTF8')),'hex'),'POSTGRES_JSONB_SHA256_V1','LEGACY_BASELINE' FROM design_templates;
UPDATE design_templates SET "activeVersionId" = id || ':baseline';
UPDATE invitations AS invitation SET "templateVersionId" = template."activeVersionId", "templateOwnerScopeKey" = template."ownerScopeKey", "organizationId" = event."organizationId"
FROM design_templates template, events event WHERE invitation."templateId" = template.id AND invitation."eventId" = event.id;
ALTER TABLE invitations ALTER COLUMN "templateVersionId" SET NOT NULL, ALTER COLUMN "organizationId" SET NOT NULL, ALTER COLUMN "templateOwnerScopeKey" SET NOT NULL;
ALTER TABLE design_templates ADD CONSTRAINT template_owner_scope CHECK ("ownerScopeKey" = CASE WHEN "organizationId" IS NULL THEN 'shared' ELSE 'org:' || "organizationId" END);
ALTER TABLE design_templates ADD CONSTRAINT template_organization_fk FOREIGN KEY ("organizationId") REFERENCES organizations(id) ON DELETE RESTRICT;
ALTER TABLE design_templates ADD CONSTRAINT template_active_version_scope_fk FOREIGN KEY ("activeVersionId",id,"ownerScopeKey") REFERENCES design_template_versions(id,"templateId","ownerScopeKey") ON DELETE RESTRICT;
ALTER TABLE design_template_versions ADD CONSTRAINT version_template_scope_fk FOREIGN KEY ("templateId","ownerScopeKey") REFERENCES design_templates(id,"ownerScopeKey") ON DELETE RESTRICT;
ALTER TABLE invitations ADD CONSTRAINT invitation_version_scope_fk FOREIGN KEY ("templateVersionId","templateId","templateOwnerScopeKey") REFERENCES design_template_versions(id,"templateId","ownerScopeKey") ON DELETE RESTRICT;
ALTER TABLE invitations ADD CONSTRAINT invitation_template_tenant CHECK ("templateOwnerScopeKey" = 'shared' OR "templateOwnerScopeKey" = 'org:' || "organizationId");
CREATE UNIQUE INDEX template_one_open_draft ON template_drafts("templateId") WHERE state = 'OPEN';
ALTER TABLE template_drafts ADD CONSTRAINT draft_scope_fk FOREIGN KEY ("templateId","ownerScopeKey") REFERENCES design_templates(id,"ownerScopeKey");
ALTER TABLE template_drafts ADD CONSTRAINT draft_state CHECK (state IN ('OPEN','PUBLISHED','DISCARDED'));
ALTER TABLE template_assignments ADD CONSTRAINT assignment_user_fk FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE template_assignments ADD CONSTRAINT assignment_actor_fk FOREIGN KEY ("assignedByUserId") REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE template_drafts ADD CONSTRAINT draft_actor_fk FOREIGN KEY ("createdByUserId") REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE template_audits ADD CONSTRAINT audit_actor_fk FOREIGN KEY ("actorUserId") REFERENCES users(id) ON DELETE RESTRICT;

-- Compatibility inserts pin once, never following a subsequent active pointer.
CREATE FUNCTION pin_invitation_template() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE template_scope text; selected_version text; event_org text;
BEGIN
 SELECT "ownerScopeKey","activeVersionId" INTO template_scope,selected_version FROM design_templates WHERE id=NEW."templateId" FOR SHARE;
 SELECT "organizationId" INTO event_org FROM events WHERE id=NEW."eventId";
 IF NEW."organizationId" IS NOT NULL AND NEW."organizationId" <> event_org THEN RAISE EXCEPTION 'invitation event organization mismatch'; END IF;
 NEW."organizationId" := event_org;
 NEW."templateOwnerScopeKey" := template_scope;
 IF TG_OP = 'INSERT' THEN NEW."templateVersionId" := COALESCE(NEW."templateVersionId",selected_version);
 ELSIF NEW."templateId" <> OLD."templateId" AND NEW."templateVersionId" = OLD."templateVersionId" THEN RAISE EXCEPTION 'explicit template version required'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER pin_invitation_template BEFORE INSERT OR UPDATE ON invitations FOR EACH ROW EXECUTE FUNCTION pin_invitation_template();
CREATE FUNCTION refuse_template_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'published template versions are immutable'; END $$;
CREATE TRIGGER immutable_template_version BEFORE UPDATE OR DELETE ON design_template_versions FOR EACH ROW EXECUTE FUNCTION refuse_template_version_mutation();
CREATE FUNCTION freeze_template_render_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.name,NEW."allowedFonts",NEW.palettes,NEW."supportedBlocks",NEW."blockVariants",NEW."defaultTheme",NEW."ownerScopeKey",NEW."organizationId") IS DISTINCT FROM (OLD.name,OLD."allowedFonts",OLD.palettes,OLD."supportedBlocks",OLD."blockVariants",OLD."defaultTheme",OLD."ownerScopeKey",OLD."organizationId") THEN RAISE EXCEPTION 'template rendering inputs are versioned'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER freeze_template_render_fields BEFORE UPDATE ON design_templates FOR EACH ROW EXECUTE FUNCTION freeze_template_render_fields();
