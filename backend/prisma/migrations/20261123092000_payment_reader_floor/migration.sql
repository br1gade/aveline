-- Old writers can expire payable attempts and discard uncertain registration.
-- The deployment must stop every writer before applying this rollback floor.
UPDATE runtime_compatibility SET "minimumRevision" = GREATEST("minimumRevision", 4)
 WHERE id = 'organization-context';
