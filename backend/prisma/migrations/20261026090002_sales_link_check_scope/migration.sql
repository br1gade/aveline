-- Only the changed case participates: conversion checks must not scan every
-- unrelated enquiry when a linked record changes.
CREATE OR REPLACE FUNCTION enforce_enquiry_conversion_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id text;
BEGIN
  IF TG_TABLE_NAME='sales_enquiries' THEN target_id := NEW.id;
  ELSE target_id := NEW."enquiryId";
  END IF;
  IF EXISTS (SELECT 1 FROM enquiry_conversions c JOIN sales_enquiries s ON s.id=c."enquiryId"
    WHERE s.id=target_id AND (c."organizationId" IS DISTINCT FROM s."organizationId" OR c."eventId" IS DISTINCT FROM s."eventId")) THEN
    RAISE EXCEPTION 'enquiry conversion linkage mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END; $$;
