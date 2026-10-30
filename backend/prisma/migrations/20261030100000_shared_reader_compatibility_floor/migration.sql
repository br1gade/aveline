-- Combined enquiry/template readers require revision 3 even while extra
-- memberships remain disabled. Already-running old replicas must be excluded
-- operationally before any F39/F44 activation; startup checks cannot stop them.
SET lock_timeout = '5s';
SET statement_timeout = '30s';
ALTER TABLE runtime_compatibility ALTER COLUMN "minimumRevision" SET DEFAULT 3;
UPDATE runtime_compatibility
SET "minimumRevision" = GREATEST("minimumRevision", 3)
WHERE id = 'organization-context';
-- Preserve multiOrganizationWrites, including an already-activated true gate.
