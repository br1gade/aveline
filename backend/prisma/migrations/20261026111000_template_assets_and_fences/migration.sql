-- AlterTable
ALTER TABLE "design_template_versions" ADD COLUMN     "sourceDraftId" TEXT,
ADD COLUMN     "sourceDraftRevision" INTEGER;

-- CreateTable
CREATE TABLE "design_template_assets" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "ownerScopeKey" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PROCESSING',
    "sourceKey" TEXT NOT NULL,
    "sanitizedKey" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "sizeBytes" INTEGER,
    "mimeType" TEXT,
    "contentHash" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "leaseGeneration" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,

    CONSTRAINT "design_template_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_template_stored_objects" (
    "key" TEXT NOT NULL,
    "assetId" TEXT,
    "templateId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'RESERVED',
    "contentHash" TEXT,
    "sizeBytes" INTEGER,
    "cleanupAfter" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "design_template_stored_objects_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "design_template_asset_references" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "ownerScopeKey" TEXT NOT NULL,
    "draftId" TEXT,
    "versionId" TEXT,
    "slot" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "assetId" TEXT NOT NULL,

    CONSTRAINT "design_template_asset_references_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "design_template_assets_sourceKey_key" ON "design_template_assets"("sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "design_template_assets_sanitizedKey_key" ON "design_template_assets"("sanitizedKey");

-- CreateIndex
CREATE INDEX "design_template_assets_state_leaseUntil_createdAt_idx" ON "design_template_assets"("state", "leaseUntil", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "design_template_assets_id_templateId_ownerScopeKey_key" ON "design_template_assets"("id", "templateId", "ownerScopeKey");

-- CreateIndex
CREATE INDEX "design_template_stored_objects_state_cleanupAfter_key_idx" ON "design_template_stored_objects"("state", "cleanupAfter", "key");

-- CreateIndex
CREATE INDEX "design_template_asset_references_assetId_idx" ON "design_template_asset_references"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "design_template_asset_references_draftId_slot_position_key" ON "design_template_asset_references"("draftId", "slot", "position");

-- CreateIndex
CREATE UNIQUE INDEX "design_template_asset_references_draftId_slot_assetId_key" ON "design_template_asset_references"("draftId", "slot", "assetId");

-- CreateIndex
CREATE UNIQUE INDEX "design_template_asset_references_versionId_slot_position_key" ON "design_template_asset_references"("versionId", "slot", "position");


ALTER TABLE invitations ADD CONSTRAINT invitation_event_tenant_fk FOREIGN KEY ("eventId","organizationId") REFERENCES events(id,"organizationId") ON DELETE CASCADE;
CREATE INDEX invitations_templateVersionId_idx ON invitations("templateVersionId");
ALTER TABLE design_template_assets ADD CONSTRAINT asset_owner_fk FOREIGN KEY ("templateId","ownerScopeKey") REFERENCES design_templates(id,"ownerScopeKey");
ALTER TABLE design_template_assets ADD CONSTRAINT asset_draft_fk FOREIGN KEY ("draftId") REFERENCES template_drafts(id);
ALTER TABLE design_template_assets ADD CONSTRAINT asset_actor_fk FOREIGN KEY ("createdByUserId") REFERENCES users(id);
ALTER TABLE design_template_assets ADD CONSTRAINT template_asset_kind CHECK (kind IN ('PHOTO','COVER'));
ALTER TABLE design_template_assets ADD CONSTRAINT template_asset_state CHECK (state IN ('PROCESSING','AVAILABLE','FAILED','RETIRED'));
ALTER TABLE design_template_asset_references ADD CONSTRAINT reference_asset_owner_fk FOREIGN KEY ("assetId","templateId","ownerScopeKey") REFERENCES design_template_assets(id,"templateId","ownerScopeKey");
ALTER TABLE design_template_asset_references ADD CONSTRAINT reference_template_owner_fk FOREIGN KEY ("templateId","ownerScopeKey") REFERENCES design_templates(id,"ownerScopeKey");
ALTER TABLE design_template_asset_references ADD CONSTRAINT reference_draft_fk FOREIGN KEY ("draftId") REFERENCES template_drafts(id);
ALTER TABLE design_template_asset_references ADD CONSTRAINT reference_version_fk FOREIGN KEY ("versionId","templateId","ownerScopeKey") REFERENCES design_template_versions(id,"templateId","ownerScopeKey");
ALTER TABLE design_template_asset_references ADD CONSTRAINT reference_parent CHECK (("draftId" IS NULL) <> ("versionId" IS NULL));
ALTER TABLE design_template_asset_references ADD CONSTRAINT reference_slot CHECK (slot IN ('HERO','GALLERY') AND position >= 0 AND position < 20);
ALTER TABLE design_template_versions ADD CONSTRAINT authored_publication_facts CHECK (provenance <> 'AUTHORED' OR ("publishedAt" IS NOT NULL AND "publishedByUserId" IS NOT NULL AND "sourceDraftId" IS NOT NULL AND "sourceDraftRevision" IS NOT NULL AND "capabilityVersion" IS NOT NULL AND "capabilityDigest" IS NOT NULL));
ALTER TABLE design_template_versions ADD CONSTRAINT baseline_no_invented_publication CHECK (provenance <> 'LEGACY_BASELINE' OR ("publishedAt" IS NULL AND "publishedByUserId" IS NULL AND "sourceDraftId" IS NULL));
CREATE FUNCTION freeze_closed_template_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state <> 'OPEN' THEN RAISE EXCEPTION 'closed template drafts are immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER freeze_closed_template_draft BEFORE UPDATE ON template_drafts FOR EACH ROW EXECUTE FUNCTION freeze_closed_template_draft();
CREATE FUNCTION freeze_referenced_template_asset() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM design_template_asset_references WHERE "assetId"=OLD.id AND "versionId" IS NOT NULL) THEN
  IF TG_OP='DELETE' OR (NEW."contentHash",NEW."sanitizedKey",NEW.width,NEW.height,NEW."mimeType",NEW."ownerScopeKey",NEW."templateId") IS DISTINCT FROM (OLD."contentHash",OLD."sanitizedKey",OLD.width,OLD.height,OLD."mimeType",OLD."ownerScopeKey",OLD."templateId") THEN RAISE EXCEPTION 'referenced template artwork is immutable'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER freeze_referenced_template_asset BEFORE UPDATE OR DELETE ON design_template_assets FOR EACH ROW EXECUTE FUNCTION freeze_referenced_template_asset();

-- An active pointer never changes a consuming invitation's design revision/cache.
DROP TRIGGER IF EXISTS guest_page_change ON design_templates;
DROP TRIGGER IF EXISTS guest_payload_change ON design_templates;
CREATE FUNCTION bump_invitation_design_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW."templateId",NEW."templateVersionId",NEW.theme,NEW."rsvpFields") IS DISTINCT FROM (OLD."templateId",OLD."templateVersionId",OLD.theme,OLD."rsvpFields") THEN NEW."designRevision" := OLD."designRevision"+1; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER a_invitation_design_revision BEFORE UPDATE ON invitations FOR EACH ROW EXECUTE FUNCTION bump_invitation_design_revision();
CREATE FUNCTION bump_child_design_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id text; event_id text; row_data jsonb;
BEGIN
 row_data := CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 IF TG_TABLE_NAME IN ('invitation_blocks','rsvp_questions') THEN parent_id := row_data->>'invitationId';
 ELSE event_id := CASE WHEN TG_TABLE_NAME='events' THEN row_data->>'id' ELSE row_data->>'eventId' END;
 END IF;
 UPDATE invitations SET "designRevision"="designRevision"+1 WHERE id=parent_id OR "eventId"=event_id;
 RETURN NULL;
END $$;
CREATE TRIGGER blocks_design_revision AFTER INSERT OR UPDATE OR DELETE ON invitation_blocks FOR EACH ROW EXECUTE FUNCTION bump_child_design_revision();
CREATE TRIGGER questions_design_revision AFTER INSERT OR UPDATE OR DELETE ON rsvp_questions FOR EACH ROW EXECUTE FUNCTION bump_child_design_revision();
CREATE TRIGGER venues_design_revision AFTER INSERT OR UPDATE OR DELETE ON venues FOR EACH ROW EXECUTE FUNCTION bump_child_design_revision();
CREATE TRIGGER timeline_design_revision AFTER INSERT OR UPDATE OR DELETE ON timeline_entries FOR EACH ROW EXECUTE FUNCTION bump_child_design_revision();
CREATE TRIGGER events_design_revision AFTER UPDATE OF title,"hostsLabel","startsAt","endsAt",timezone,locales,"defaultLocale",translations,"sideALabel","sideBLabel" ON events FOR EACH ROW EXECUTE FUNCTION bump_child_design_revision();
