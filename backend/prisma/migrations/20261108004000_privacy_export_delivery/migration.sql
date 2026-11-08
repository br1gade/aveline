ALTER TABLE "data_subject_requests"
  ADD COLUMN "exportGenerationId" UUID,
  ADD COLUMN "exportGeneratedAt" TIMESTAMP(3),
  ADD COLUMN "exportGeneratedByUserId" TEXT,
  ADD COLUMN "exportDeliveredByUserId" TEXT;
