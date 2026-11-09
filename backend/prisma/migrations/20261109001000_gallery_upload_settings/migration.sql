BEGIN;

ALTER TABLE "invitations" ADD COLUMN "galleryUploadsEnabled" BOOLEAN;
UPDATE "invitations" SET "galleryUploadsEnabled" = true WHERE "galleryUploadsEnabled" IS NULL;
-- Flush deferred template and invitation checks before changing the column.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE "invitations"
  ALTER COLUMN "galleryUploadsEnabled" SET DEFAULT false,
  ALTER COLUMN "galleryUploadsEnabled" SET NOT NULL;

COMMIT;
