-- Existing requests/receipts retain their verified scope. Owner identity is an
-- optional additional human verification, never inferred from a shared address.
ALTER TABLE data_subject_requests ADD COLUMN "verifiedOwnerUserId" TEXT,
  ADD COLUMN "ownerAccountVerifiedAt" TIMESTAMP(3);
ALTER TABLE enquiry_privacy_redactions ADD COLUMN "verifiedOwnerUserId" TEXT;
ALTER TABLE data_subject_requests DROP CONSTRAINT enquiry_subject_source;
ALTER TABLE data_subject_requests ADD CONSTRAINT enquiry_subject_source CHECK (
  ("subjectSource"='EMAIL' AND "subjectEmail" IS NOT NULL)
  OR ("subjectSource"='STAFF_ENQUIRY' AND
    (("subjectEmail" IS NULL AND "verifiedOwnerUserId" IS NULL AND "ownerAccountVerifiedAt" IS NULL)
    OR ("subjectEmail" IS NOT NULL AND "verifiedOwnerUserId" IS NOT NULL AND "ownerAccountVerifiedAt" IS NOT NULL)))
);
