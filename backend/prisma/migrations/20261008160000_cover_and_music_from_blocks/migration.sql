-- The cover and the music move to the blocks that show them: the cover is the
-- HERO block's first photo and the music is the MUSIC block's audio. These
-- three columns were read by the public invitation but never written by any
-- endpoint, so a host had no way to set either.
--
-- Refuses rather than drops if anything was ever put in them by hand, so this
-- cannot silently discard data on a database it was not written against.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "invitations"
    WHERE "coverAssetId" IS NOT NULL OR "coverUrl" IS NOT NULL OR "musicUrl" IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'invitations has cover or music values set; move them to HERO/MUSIC block assetIds before dropping';
  END IF;
END $$;

-- DropForeignKey
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_coverAssetId_fkey";

-- AlterTable
ALTER TABLE "invitations" DROP COLUMN "coverAssetId",
DROP COLUMN "coverUrl",
DROP COLUMN "musicUrl";
