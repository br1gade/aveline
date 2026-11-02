-- AlterTable
ALTER TABLE "design_template_versions" ADD COLUMN     "rendererManifest" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "design_template_stored_objects" ADD COLUMN     "materializationId" TEXT;

-- CreateTable
CREATE TABLE "template_materializations" (
    "id" TEXT NOT NULL,
    "previewId" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "targetVersionId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PROCESSING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "template_materializations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitation_template_assets" (
    "id" TEXT NOT NULL,
    "materializationId" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateVersionId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "ownerScopeKey" TEXT NOT NULL,
    "sourceAssetId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "objectKey" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PROCESSING',
    "contentHash" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "leaseGeneration" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitation_template_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "template_materializations_previewId_key" ON "template_materializations"("previewId");

-- CreateIndex
CREATE INDEX "template_materializations_state_expiresAt_idx" ON "template_materializations"("state", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_template_assets_objectKey_key" ON "invitation_template_assets"("objectKey");

-- CreateIndex
CREATE INDEX "invitation_template_assets_invitationId_templateVersionId_s_idx" ON "invitation_template_assets"("invitationId", "templateVersionId", "state");

-- CreateIndex
CREATE INDEX "invitation_template_assets_state_leaseUntil_createdAt_idx" ON "invitation_template_assets"("state", "leaseUntil", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "invitation_template_assets_materializationId_slot_position_key" ON "invitation_template_assets"("materializationId", "slot", "position");

ALTER TABLE template_materializations ADD CONSTRAINT materialization_event_tenant_fk FOREIGN KEY ("eventId","organizationId") REFERENCES events(id,"organizationId") ON DELETE CASCADE;
ALTER TABLE template_materializations ADD CONSTRAINT materialization_preview_fk FOREIGN KEY ("previewId") REFERENCES template_previews(id) ON DELETE RESTRICT;
ALTER TABLE invitation_template_assets ADD CONSTRAINT binding_materialization_fk FOREIGN KEY ("materializationId") REFERENCES template_materializations(id) ON DELETE CASCADE;
ALTER TABLE invitation_template_assets ADD CONSTRAINT binding_event_tenant_fk FOREIGN KEY ("eventId","organizationId") REFERENCES events(id,"organizationId") ON DELETE CASCADE;
ALTER TABLE invitation_template_assets ADD CONSTRAINT binding_version_scope_fk FOREIGN KEY ("templateVersionId","templateId","ownerScopeKey") REFERENCES design_template_versions(id,"templateId","ownerScopeKey");
ALTER TABLE invitation_template_assets ADD CONSTRAINT binding_source_scope_fk FOREIGN KEY ("sourceAssetId","templateId","ownerScopeKey") REFERENCES design_template_assets(id,"templateId","ownerScopeKey");
ALTER TABLE invitation_template_assets ADD CONSTRAINT binding_scope CHECK ("ownerScopeKey"='shared' OR "ownerScopeKey"='org:'||"organizationId");
ALTER TABLE invitation_template_assets ADD CONSTRAINT binding_slot CHECK (slot IN ('HERO','GALLERY') AND position>=0 AND position<20);
CREATE UNIQUE INDEX bound_invitation_slot_position ON invitation_template_assets("invitationId",slot,position) WHERE state='BOUND';
CREATE FUNCTION check_template_binding_pin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state='BOUND' AND NOT EXISTS (SELECT 1 FROM invitations i WHERE i.id=NEW."invitationId" AND i."eventId"=NEW."eventId" AND i."organizationId"=NEW."organizationId" AND i."templateVersionId"=NEW."templateVersionId") THEN RAISE EXCEPTION 'template artwork binding does not match final invitation pin'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER template_binding_pin AFTER INSERT OR UPDATE ON invitation_template_assets DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_template_binding_pin();
CREATE FUNCTION check_invitation_artwork_pin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM invitation_template_assets a WHERE a."invitationId"=NEW.id AND a.state='BOUND' AND a."templateVersionId"<>NEW."templateVersionId") THEN RAISE EXCEPTION 'template artwork binding does not match final invitation pin'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER invitation_artwork_pin AFTER UPDATE ON invitations DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_invitation_artwork_pin();
CREATE FUNCTION freeze_template_version_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF OLD."versionId" IS NOT NULL THEN RAISE EXCEPTION 'immutable template version artwork reference'; END IF; IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
CREATE TRIGGER immutable_template_version_reference BEFORE UPDATE OR DELETE ON design_template_asset_references FOR EACH ROW EXECUTE FUNCTION freeze_template_version_reference();
CREATE FUNCTION retire_deleted_event_artwork() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE design_template_stored_objects o SET state='RETIRED',"cleanupAfter"=now() WHERE o."materializationId" IN (SELECT id FROM template_materializations WHERE "eventId"=OLD.id);
 RETURN OLD;
END $$;
CREATE TRIGGER retire_deleted_event_artwork BEFORE DELETE ON events FOR EACH ROW EXECUTE FUNCTION retire_deleted_event_artwork();
CREATE FUNCTION retire_deleted_invitation_artwork() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 UPDATE design_template_stored_objects o SET state='RETIRED',"cleanupAfter"=now() WHERE o."materializationId" IN (SELECT id FROM template_materializations WHERE "invitationId"=OLD.id);
 DELETE FROM invitation_template_assets WHERE "invitationId"=OLD.id;
 UPDATE template_materializations SET state='RETIRED' WHERE "invitationId"=OLD.id;
 RETURN OLD;
END $$;
CREATE TRIGGER retire_deleted_invitation_artwork BEFORE DELETE ON invitations FOR EACH ROW EXECUTE FUNCTION retire_deleted_invitation_artwork();
DROP TRIGGER pin_invitation_template ON invitations;
CREATE TRIGGER pin_invitation_template BEFORE INSERT OR UPDATE OF "templateId","templateVersionId","eventId","organizationId" ON invitations FOR EACH ROW EXECUTE FUNCTION pin_invitation_template();
