-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('NONE', 'SUPPORT', 'ADMIN');

-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'MANAGER', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "EventRole" AS ENUM ('OWNER', 'COORDINATOR', 'DESIGNER', 'VIEWER');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('PHOTO', 'COVER', 'SIGNATURE', 'LOGO', 'AUDIO');

-- AlterEnum
ALTER TYPE "BlockType" ADD VALUE 'SIGNATURE';

-- AlterEnum
ALTER TYPE "QuestionType" ADD VALUE 'SIGNATURE';

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_organizationId_fkey";

-- DropIndex
DROP INDEX "users_organizationId_idx";

-- AlterTable
ALTER TABLE "invitation_blocks" ADD COLUMN     "assetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "variant" TEXT;

-- AlterTable
-- templateId is added nullable here and made NOT NULL after the backfill
-- below, so this migration is safe against a populated database.
ALTER TABLE "invitations" ADD COLUMN     "coverAssetId" TEXT,
ADD COLUMN     "templateId" TEXT;

-- AlterTable
ALTER TABLE "rsvps" ADD COLUMN     "signatureAssetId" TEXT;

-- AlterTable
ALTER TABLE "seats" ADD COLUMN     "position" INTEGER;

-- AlterTable
ALTER TABLE "tables" ADD COLUMN     "venueId" TEXT,
ADD COLUMN     "zone" TEXT;

-- AlterTable
ALTER TABLE "users" DROP COLUMN "organizationId",
DROP COLUMN "role",
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "platformRole" "PlatformRole" NOT NULL DEFAULT 'NONE';

-- AlterTable
ALTER TABLE "venues" ADD COLUMN     "capacity" INTEGER,
ADD COLUMN     "profileId" TEXT;

-- DropEnum
DROP TYPE "UserRole";

-- CreateTable
CREATE TABLE "organization_memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "role" "EventRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "venue_profiles" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "city" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "capacity" INTEGER,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "venue_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_templates" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "allowedFonts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "palettes" JSONB NOT NULL DEFAULT '[]',
    "supportedBlocks" "BlockType"[] DEFAULT ARRAY[]::"BlockType"[],
    "defaultTheme" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "url" TEXT NOT NULL,
    "sizeBytes" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "mimeType" TEXT,
    "altText" JSONB NOT NULL DEFAULT '{}',
    "uploadedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "organization_memberships_organizationId_idx" ON "organization_memberships"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_memberships_userId_organizationId_key" ON "organization_memberships"("userId", "organizationId");

-- CreateIndex
CREATE INDEX "event_memberships_eventId_idx" ON "event_memberships"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "event_memberships_userId_eventId_key" ON "event_memberships"("userId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "venue_profiles_vendorId_key" ON "venue_profiles"("vendorId");

-- CreateIndex
CREATE INDEX "venue_profiles_city_idx" ON "venue_profiles"("city");

-- CreateIndex
CREATE UNIQUE INDEX "design_templates_key_key" ON "design_templates"("key");

-- CreateIndex
CREATE INDEX "media_assets_eventId_idx" ON "media_assets"("eventId");

-- CreateIndex
CREATE INDEX "invitations_templateId_idx" ON "invitations"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "seats_tableId_position_key" ON "seats"("tableId", "position");

-- ─────────────────────────────────────────────────────────────────────
-- Backfill: every existing invitation referenced a template by string key.
-- Create the corresponding DesignTemplate rows, point invitations at them,
-- then enforce the constraint and drop the old column.
-- ─────────────────────────────────────────────────────────────────────

INSERT INTO "design_templates" ("id", "key", "name", "allowedFonts", "palettes", "supportedBlocks", "defaultTheme", "isActive", "createdAt", "updatedAt")
SELECT DISTINCT
    'tpl_' || "template",
    "template",
    initcap("template"),
    ARRAY[]::TEXT[],
    '[]'::jsonb,
    ARRAY[]::"BlockType"[],
    '{}'::jsonb,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "invitations"
WHERE "template" IS NOT NULL
ON CONFLICT ("key") DO NOTHING;

UPDATE "invitations"
SET "templateId" = 'tpl_' || "template"
WHERE "templateId" IS NULL AND "template" IS NOT NULL;

ALTER TABLE "invitations" ALTER COLUMN "templateId" SET NOT NULL;
ALTER TABLE "invitations" DROP COLUMN "template";

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_memberships" ADD CONSTRAINT "event_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_memberships" ADD CONSTRAINT "event_memberships_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venues" ADD CONSTRAINT "venues_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "venue_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "venue_profiles" ADD CONSTRAINT "venue_profiles_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "design_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_coverAssetId_fkey" FOREIGN KEY ("coverAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rsvps" ADD CONSTRAINT "rsvps_signatureAssetId_fkey" FOREIGN KEY ("signatureAssetId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

