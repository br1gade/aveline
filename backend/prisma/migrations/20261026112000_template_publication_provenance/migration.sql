-- AlterTable
ALTER TABLE "invitations" ALTER COLUMN "designRevision" SET DATA TYPE BIGINT;

-- AlterTable
ALTER TABLE "design_templates" ADD COLUMN     "isLegacyBootstrap" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "template_previews" ADD COLUMN     "capabilityDigest" TEXT,
ADD COLUMN     "draftRevision" INTEGER,
ALTER COLUMN "designRevision" SET DATA TYPE BIGINT;

DROP TRIGGER capture_template_baseline ON design_templates;
CREATE TRIGGER capture_template_baseline AFTER INSERT ON design_templates FOR EACH ROW WHEN (NEW."isLegacyBootstrap") EXECUTE FUNCTION capture_template_baseline();
ALTER TABLE invitations ADD CONSTRAINT positive_design_revision CHECK ("designRevision">0);
CREATE UNIQUE INDEX template_draft_composite_owner ON template_drafts(id,"templateId","ownerScopeKey");
ALTER TABLE design_template_assets ADD CONSTRAINT asset_draft_owner_fk FOREIGN KEY ("draftId","templateId","ownerScopeKey") REFERENCES template_drafts(id,"templateId","ownerScopeKey");
ALTER TABLE design_template_asset_references ADD CONSTRAINT reference_draft_owner_fk FOREIGN KEY ("draftId","templateId","ownerScopeKey") REFERENCES template_drafts(id,"templateId","ownerScopeKey");
ALTER TABLE design_template_versions ADD CONSTRAINT version_publication_actor_fk FOREIGN KEY ("publishedByUserId") REFERENCES users(id);
ALTER TABLE design_template_versions ADD CONSTRAINT version_source_draft_fk FOREIGN KEY ("sourceDraftId") REFERENCES template_drafts(id);
