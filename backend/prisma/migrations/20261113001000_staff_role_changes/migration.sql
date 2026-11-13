-- Every platform-role change, durably (StaffService).
-- CreateEnum
CREATE TYPE "StaffRoleChangeSource" AS ENUM ('API', 'OPS');

-- CreateTable
CREATE TABLE "staff_role_changes" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "subjectUserId" TEXT,
    "previousRole" "PlatformRole" NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "source" "StaffRoleChangeSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_role_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "staff_role_changes_subjectUserId_createdAt_idx" ON "staff_role_changes"("subjectUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "staff_role_changes" ADD CONSTRAINT "staff_role_changes_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "staff_role_changes" ADD CONSTRAINT "staff_role_changes_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;


-- The staff list reads the few staff among every account. SQL-only: Prisma does
-- not diff partial indexes (backend/CLAUDE.md §11).
CREATE INDEX "users_staff_email_idx" ON "users"("email") WHERE "platformRole" <> 'NONE';
