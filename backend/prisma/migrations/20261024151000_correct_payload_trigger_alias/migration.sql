-- Forward-only correction: preserve the checksum of the previously applied migration.
CREATE OR REPLACE FUNCTION invalidate_guest_payload() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  current_row jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
  event_ids text[];
  guest_ids text[];
BEGIN
  IF TG_TABLE_NAME = 'seating_arrangements' AND TG_OP = 'UPDATE'
    AND (previous->>'id', previous->>'eventId', previous->>'venueId') IS NOT DISTINCT FROM
      (current_row->>'id', current_row->>'eventId', current_row->>'venueId') THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME IN ('guests', 'households') THEN
    INSERT INTO guest_payload_changes ("eventId", scope, "transactionId")
      SELECT DISTINCT entry->>'eventId', 'household:' || CASE WHEN TG_TABLE_NAME = 'guests' THEN entry->>'householdId' ELSE entry->>'id' END, txid_current()
      FROM jsonb_array_elements(jsonb_build_array(previous, current_row)) entry WHERE entry->>'eventId' IS NOT NULL
      ON CONFLICT DO NOTHING;
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'rsvp_answers' THEN
    SELECT array_agg("guestId") INTO guest_ids FROM rsvps WHERE id IN (previous->>'rsvpId', current_row->>'rsvpId');
  ELSIF TG_TABLE_NAME IN ('rsvps', 'attendance_responses', 'seats', 'seat_releases') THEN
    guest_ids := ARRAY[previous->>'guestId', current_row->>'guestId'];
  ELSIF TG_TABLE_NAME = 'guest_acknowledgements' THEN
    guest_ids := ARRAY[previous->>'subjectGuestId', current_row->>'subjectGuestId', previous->>'signerGuestId', current_row->>'signerGuestId'];
  END IF;
  IF guest_ids IS NOT NULL THEN
    INSERT INTO guest_payload_changes ("eventId", scope, "transactionId")
      SELECT DISTINCT "eventId", 'household:' || "householdId", txid_current() FROM guests WHERE id = ANY(guest_ids) ON CONFLICT DO NOTHING;
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'events' THEN
    event_ids := ARRAY[previous->>'id', current_row->>'id'];
  ELSIF TG_TABLE_NAME = 'design_templates' THEN
    SELECT array_agg("eventId") INTO event_ids FROM invitations WHERE "templateId" IN (previous->>'id', current_row->>'id');
  ELSIF TG_TABLE_NAME IN ('invitation_blocks', 'rsvp_questions') THEN
    SELECT array_agg("eventId") INTO event_ids FROM invitations WHERE id IN (previous->>'invitationId', current_row->>'invitationId');
  ELSE
    event_ids := ARRAY[previous->>'eventId', current_row->>'eventId'];
  END IF;
  INSERT INTO guest_payload_changes ("eventId", scope, "transactionId")
    SELECT DISTINCT id, 'shared', txid_current() FROM unnest(event_ids) id WHERE id IS NOT NULL ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;
