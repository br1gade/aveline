-- RSVPs for independent households must not hold a shared arrangement lock
-- during the rest of their transaction. Revisions still change atomically with
-- their inputs, before COMMIT becomes visible to any planner.
CREATE OR REPLACE FUNCTION bump_seating_scopes(p_scopes text[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  touched text[] := COALESCE(NULLIF(current_setting('aveline.seating_touched', true), '')::text[], ARRAY[]::text[]);
  fresh text[];
BEGIN
  SELECT array_agg(DISTINCT id ORDER BY id) INTO fresh FROM unnest(p_scopes) id
    WHERE id IS NOT NULL AND NOT (id = ANY(touched));
  IF fresh IS NULL THEN RETURN; END IF;
  PERFORM id FROM seating_arrangements WHERE id = ANY(fresh) ORDER BY id FOR UPDATE;
  UPDATE seating_arrangements SET revision = revision + 1 WHERE id = ANY(fresh);
  PERFORM set_config('aveline.seating_touched', (touched || fresh)::text, true);
END $$;

CREATE OR REPLACE FUNCTION bump_event_seating(p_event text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM bump_seating_scopes(ARRAY(SELECT id FROM seating_arrangements WHERE "eventId" = p_event ORDER BY id));
END $$;

CREATE OR REPLACE FUNCTION invalidate_seating_inputs() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  current_row jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
  event_ids text[];
  event_id text;
BEGIN
  IF TG_TABLE_NAME IN ('tables', 'seats', 'seat_releases') THEN
    PERFORM bump_seating_scopes(ARRAY[previous->>'arrangementId', current_row->>'arrangementId']);
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME = 'rsvps' THEN
    SELECT array_agg(DISTINCT "eventId") INTO event_ids FROM guests
      WHERE id IN (previous->>'guestId', current_row->>'guestId');
  ELSIF TG_TABLE_NAME = 'events' THEN
    event_ids := ARRAY[previous->>'id', current_row->>'id'];
  ELSE
    event_ids := ARRAY[previous->>'eventId', current_row->>'eventId'];
  END IF;
  FOR event_id IN SELECT DISTINCT value FROM unnest(event_ids) value WHERE value IS NOT NULL ORDER BY value LOOP
    PERFORM bump_event_seating(event_id);
  END LOOP;
  RETURN NULL;
END $$;

DO $$
DECLARE entry record;
BEGIN
  FOR entry IN SELECT * FROM (VALUES
    ('seating_tables_revision', 'tables'), ('seating_seats_revision', 'seats'),
    ('seating_releases_revision', 'seat_releases'), ('seating_guests_revision', 'guests'),
    ('seating_rsvps_revision', 'rsvps'), ('seating_attendance_revision', 'attendance_responses'),
    ('seating_venues_revision', 'venues'), ('seating_timeline_revision', 'timeline_entries')
  ) AS triggers(name, relation) LOOP
    EXECUTE format('DROP TRIGGER %I ON %I', entry.name, entry.relation);
    EXECUTE format('CREATE CONSTRAINT TRIGGER %I AFTER INSERT OR UPDATE OR DELETE ON %I DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION invalidate_seating_inputs()', entry.name, entry.relation);
  END LOOP;
END $$;

DROP TRIGGER seating_policy_revision ON events;
CREATE CONSTRAINT TRIGGER seating_policy_revision AFTER UPDATE ON events
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
WHEN ((OLD.status, OLD."attendanceMode", OLD."attendanceRevision") IS DISTINCT FROM
  (NEW.status, NEW."attendanceMode", NEW."attendanceRevision")) EXECUTE FUNCTION invalidate_seating_inputs();
