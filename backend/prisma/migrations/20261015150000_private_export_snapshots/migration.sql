-- CreateTable
CREATE TABLE "export_snapshots" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "kind" "ExportKind" NOT NULL,
    "format" "ExportFormat" NOT NULL DEFAULT 'CSV',
    "locale" TEXT NOT NULL,
    "includesContacts" BOOLEAN NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failureReason" TEXT,
    "snapshotAt" TIMESTAMP(3),
    "timezone" TEXT,
    "attendanceRevision" INTEGER,
    "dataRevision" TEXT,
    "artifactKey" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "export_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_artifacts" (
    "key" TEXT NOT NULL,
    "snapshotId" TEXT,
    "cleanupAfter" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_artifacts_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "export_snapshot_subjects" (
    "snapshotId" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,

    CONSTRAINT "export_snapshot_subjects_pkey" PRIMARY KEY ("snapshotId","fingerprint")
);

-- CreateTable
CREATE TABLE "export_privacy_fences" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "export_privacy_fences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "export_snapshots_eventId_createdAt_idx" ON "export_snapshots"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "export_snapshots_status_nextAttemptAt_idx" ON "export_snapshots"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "export_snapshots_status_leaseUntil_idx" ON "export_snapshots"("status", "leaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "export_snapshots_eventId_requestedByUserId_idempotencyKey_key" ON "export_snapshots"("eventId", "requestedByUserId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "export_artifacts_cleanupAfter_idx" ON "export_artifacts"("cleanupAfter");

-- CreateIndex
CREATE INDEX "export_artifacts_snapshotId_idx" ON "export_artifacts"("snapshotId");

-- CreateIndex
CREATE INDEX "export_snapshot_subjects_fingerprint_idx" ON "export_snapshot_subjects"("fingerprint");

-- AddForeignKey
ALTER TABLE "export_snapshots" ADD CONSTRAINT "export_snapshots_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_artifacts" ADD CONSTRAINT "export_artifacts_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "export_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_snapshot_subjects" ADD CONSTRAINT "export_snapshot_subjects_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "export_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

