-- Enables composite tenant references without changing event ownership or IDs.
-- Existing id primary-key uniqueness guarantees this is populated-data safe.
CREATE UNIQUE INDEX "events_id_organizationId_key" ON "events"("id", "organizationId");
