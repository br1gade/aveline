CREATE EXTENSION IF NOT EXISTS btree_gist;
INSERT INTO enquiry_privacy_fences (id,revision) VALUES ('intake',0) ON CONFLICT DO NOTHING;
ALTER TABLE consultations ADD CONSTRAINT consultation_positive_interval CHECK ("endsAt" >= "startsAt" + interval '5 minutes' AND "endsAt" <= "startsAt" + interval '8 hours');
ALTER TABLE consultations ADD CONSTRAINT consultation_operator_no_overlap EXCLUDE USING gist ("operatorUserId" WITH =, tstzrange("startsAt","endsAt",'[)') WITH &&) WHERE (status = 'SCHEDULED');
ALTER TABLE consultations ADD CONSTRAINT consultation_lifecycle CHECK (revision >= 1 AND ((status='SCHEDULED' AND "completedAt" IS NULL AND "cancelledAt" IS NULL) OR (status='COMPLETED' AND "completedAt" IS NOT NULL AND "cancelledAt" IS NULL) OR (status='CANCELLED' AND "completedAt" IS NULL AND "cancelledAt" IS NOT NULL)));
ALTER TABLE sales_enquiries ADD CONSTRAINT enquiry_closure_shape CHECK ((stage='CLOSED' AND "closedAt" IS NOT NULL AND "closureReason" IS NOT NULL AND "cleanupDueAt" IS NOT NULL) OR (stage<>'CLOSED' AND "closedAt" IS NULL AND "closureReason" IS NULL AND "cleanupDueAt" IS NULL));
ALTER TABLE sales_enquiries ADD CONSTRAINT enquiry_counts CHECK (revision >= 1 AND "privacyRevision" >= 0 AND ("estimatedGuestCount" IS NULL OR "estimatedGuestCount" BETWEEN 0 AND 100000));
ALTER TABLE sales_enquiries ADD CONSTRAINT enquiry_link_shape CHECK ("eventId" IS NULL OR "organizationId" IS NOT NULL);
ALTER TABLE sales_enquiries ADD CONSTRAINT enquiry_locale CHECK ("preferredLocale" IS NULL OR "preferredLocale" IN ('en','ru','fr','hy'));
ALTER TABLE enquiry_contacts ADD CONSTRAINT enquiry_contact_shape CHECK (revision >= 1 AND (("redactedAt" IS NULL AND length(trim(name)) BETWEEN 1 AND 200 AND name IS NOT NULL AND (email IS NOT NULL OR phone IS NOT NULL)) OR ("redactedAt" IS NOT NULL AND name IS NULL AND email IS NULL AND phone IS NULL)));
ALTER TABLE enquiry_contacts ADD CONSTRAINT enquiry_contact_channels CHECK ((email IS NULL OR email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') AND (phone IS NULL OR phone ~ '^\+[1-9][0-9]{6,14}$'));
ALTER TABLE enquiry_notes ADD CONSTRAINT enquiry_note_shape CHECK (("redactedAt" IS NULL AND body IS NOT NULL AND length(trim(body)) BETWEEN 1 AND 10000) OR ("redactedAt" IS NOT NULL AND body IS NULL));
ALTER TABLE enquiry_commands ADD CONSTRAINT enquiry_command_shape CHECK ("idempotencyKey" ~ '^[!-~][ -~]{7,127}$' AND "appliedRevision">=1 AND ("invalidatedAt" IS NULL OR "requestFingerprint" IS NULL));
ALTER TABLE data_subject_requests ADD CONSTRAINT enquiry_subject_source CHECK (("subjectSource"='EMAIL' AND "subjectEmail" IS NOT NULL) OR ("subjectSource"='STAFF_ENQUIRY' AND "subjectEmail" IS NULL));
CREATE INDEX enquiries_cleanup_due ON sales_enquiries ("cleanupDueAt",id) WHERE stage='CLOSED' AND "personalDataClearedAt" IS NULL;
CREATE INDEX enquiry_contacts_email ON enquiry_contacts(email) WHERE email IS NOT NULL;
CREATE INDEX enquiry_contacts_phone ON enquiry_contacts(phone) WHERE phone IS NOT NULL;
CREATE INDEX enquiry_contacts_name_prefix ON enquiry_contacts(lower(name) text_pattern_ops);
CREATE INDEX consultation_operator_calendar ON consultations ("operatorUserId","startsAt",id) WHERE status='SCHEDULED';
CREATE FUNCTION enforce_enquiry_conversion_link() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM enquiry_conversions c JOIN sales_enquiries s ON s.id=c."enquiryId" WHERE c."organizationId" IS DISTINCT FROM s."organizationId" OR c."eventId" IS DISTINCT FROM s."eventId") THEN
    RAISE EXCEPTION 'enquiry conversion linkage mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
CREATE CONSTRAINT TRIGGER enquiry_conversion_link AFTER INSERT OR UPDATE ON enquiry_conversions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_enquiry_conversion_link();
CREATE CONSTRAINT TRIGGER enquiry_root_conversion_link AFTER INSERT OR UPDATE OF "organizationId","eventId" ON sales_enquiries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_enquiry_conversion_link();
