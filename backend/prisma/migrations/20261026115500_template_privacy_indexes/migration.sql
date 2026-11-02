-- CreateIndex
CREATE INDEX "design_template_versions_publishedByUserId_idx" ON "design_template_versions"("publishedByUserId");

-- CreateIndex
CREATE INDEX "template_drafts_createdByUserId_createdAt_idx" ON "template_drafts"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "template_audits_actorUserId_createdAt_idx" ON "template_audits"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "template_previews_actorUserId_expiresAt_idx" ON "template_previews"("actorUserId", "expiresAt");

-- CreateIndex
CREATE INDEX "template_receipts_actorUserId_createdAt_idx" ON "template_receipts"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "design_template_assets_createdByUserId_createdAt_idx" ON "design_template_assets"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "design_template_stored_objects_assetId_idx" ON "design_template_stored_objects"("assetId");

-- CreateIndex
CREATE INDEX "design_template_stored_objects_materializationId_idx" ON "design_template_stored_objects"("materializationId");

-- CreateIndex
CREATE INDEX "template_materializations_actorUserId_expiresAt_idx" ON "template_materializations"("actorUserId", "expiresAt");

-- CreateIndex
CREATE INDEX "template_materializations_eventId_idx" ON "template_materializations"("eventId");

-- CreateIndex
CREATE INDEX "template_materializations_invitationId_idx" ON "template_materializations"("invitationId");

