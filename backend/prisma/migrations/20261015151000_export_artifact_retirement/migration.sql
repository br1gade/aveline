-- Existing ledger rows remain eligible for publication until cleanup claims them.
ALTER TABLE "export_artifacts" ADD COLUMN "isRetired" BOOLEAN;
UPDATE "export_artifacts" SET "isRetired" = false;
ALTER TABLE "export_artifacts" ALTER COLUMN "isRetired" SET DEFAULT false;
ALTER TABLE "export_artifacts" ALTER COLUMN "isRetired" SET NOT NULL;
