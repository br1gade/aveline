-- Smaller copies of uploaded photos, made by a background job. New columns with
-- defaults; existing photos are picked up by the same job.

-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "variants" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "variantsError" TEXT,
ADD COLUMN     "variantsProcessedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "media_assets_variantsProcessedAt_createdAt_idx" ON "media_assets"("variantsProcessedAt", "createdAt");

