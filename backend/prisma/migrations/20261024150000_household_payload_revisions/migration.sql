BEGIN;

-- Append-only counters avoid shared row locks in RSVP transactions. No parent
-- FK: domain lock ordering must not acquire event locks after household locks.
CREATE TABLE guest_payload_versions (
  "eventId" text NOT NULL, scope text NOT NULL, revision bigint NOT NULL DEFAULT 0,
  PRIMARY KEY ("eventId", scope)
);
CREATE TABLE guest_payload_changes (
  "eventId" text NOT NULL, scope text NOT NULL, "transactionId" bigint NOT NULL,
  PRIMARY KEY ("eventId", scope, "transactionId")
);

CREATE FUNCTION guest_payload_revision(target_event text, target_scope text) RETURNS bigint
LANGUAGE sql STABLE STRICT AS $$
  SELECT COALESCE((SELECT revision FROM guest_payload_versions WHERE "eventId" = target_event AND scope = target_scope), 0)
    + (SELECT count(*) FROM guest_payload_changes WHERE "eventId" = target_event AND scope = target_scope);
$$;

CREATE FUNCTION invalidate_guest_payload() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  current_row jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
  event_ids text[];
  guest_ids text[];
BEGIN
  IF TG_TABLE_NAME = 'seating_arrangements' AND TG_OP = 'UPDATE'
    AND (previous->>'id', previous->>'eventId', previous->>'venueId') IS NOT DISTINCT FROM
      (current_entry->>'id', current_entry->>'eventId', current_entry->>'venueId') THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME IN ('guests', 'households') THEN
    INSERT INTO guest_payload_changes ("eventId", scope, "transactionId")
      SELECT DISTINCT entry->>'eventId', 'household:' || CASE WHEN TG_TABLE_NAME = 'guests' THEN entry->>'householdId' ELSE entry->>'id' END, txid_current()
      FROM jsonb_array_elements(jsonb_build_array(previous, current_row)) entry WHERE entry->>'eventId' IS NOT NULL
      ON CONFLICT DO NOTHING;
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'rsvp_answers' THEN
    SELECT array_agg("guestId") INTO guest_ids FROM rsvps WHERE id IN (previous->>'rsvpId', current_entry->>'rsvpId');
  ELSIF TG_TABLE_NAME IN ('rsvps', 'attendance_responses', 'seats', 'seat_releases') THEN
    guest_ids := ARRAY[previous->>'guestId', current_entry->>'guestId'];
  ELSIF TG_TABLE_NAME = 'guest_acknowledgements' THEN
    guest_ids := ARRAY[previous->>'subjectGuestId', current_entry->>'subjectGuestId', previous->>'signerGuestId', current_entry->>'signerGuestId'];
  END IF;
  IF guest_ids IS NOT NULL THEN
    INSERT INTO guest_payload_changes ("eventId", scope, "transactionId")
      SELECT DISTINCT "eventId", 'household:' || "householdId", txid_current() FROM guests WHERE id = ANY(guest_ids) ON CONFLICT DO NOTHING;
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'events' THEN
    event_ids := ARRAY[previous->>'id', current_entry->>'id'];
  ELSIF TG_TABLE_NAME = 'design_templates' THEN
    SELECT array_agg("eventId") INTO event_ids FROM invitations WHERE "templateId" IN (previous->>'id', current_entry->>'id');
  ELSIF TG_TABLE_NAME IN ('invitation_blocks', 'rsvp_questions') THEN
    SELECT array_agg("eventId") INTO event_ids FROM invitations WHERE id IN (previous->>'invitationId', current_entry->>'invitationId');
  ELSE
    event_ids := ARRAY[previous->>'eventId', current_entry->>'eventId'];
  END IF;
  INSERT INTO guest_payload_changes ("eventId", scope, "transactionId")
    SELECT DISTINCT id, 'shared', txid_current() FROM unnest(event_ids) id WHERE id IS NOT NULL ON CONFLICT DO NOTHING;
  RETURN NULL;
END $$;

DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY['events', 'invitations', 'invitation_blocks', 'rsvp_questions', 'design_templates',
    'media_assets', 'venues', 'timeline_entries', 'households', 'guests', 'rsvps', 'rsvp_answers', 'attendance_policies',
    'attendance_responses', 'tables', 'seats', 'seat_releases', 'seating_arrangements', 'tickets', 'ticket_orders',
    'guest_acknowledgements', 'guest_media'] LOOP
    EXECUTE format('CREATE TRIGGER guest_payload_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION invalidate_guest_payload()', relation);
  END LOOP;
END $$;

COMMIT;
