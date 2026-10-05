-- AlterTable
ALTER TABLE "guests" ADD COLUMN     "anonymizedAt" TIMESTAMP(3),
ADD COLUMN     "consentAt" TIMESTAMP(3),
ADD COLUMN     "consentSource" TEXT;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "deletedAt" TIMESTAMP(3);

