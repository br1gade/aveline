-- Existing notes may mix staff and public text; retain them without inventing provenance.
CREATE TABLE "privacy_request_submissions" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "privacy_request_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "privacy_request_submissions_requestId_createdAt_id_idx"
    ON "privacy_request_submissions"("requestId", "createdAt", "id");

ALTER TABLE "privacy_request_submissions"
    ADD CONSTRAINT "privacy_request_submissions_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "data_subject_requests"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
