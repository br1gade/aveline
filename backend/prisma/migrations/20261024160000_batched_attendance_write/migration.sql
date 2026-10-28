-- Keep the existing scope/summary semantics in one database round trip.
CREATE FUNCTION save_guest_attendance(target_event text, target_guest text, payload jsonb)
RETURNS SETOF rsvps LANGUAGE plpgsql AS $$
DECLARE
  policy_revision integer := (payload->>'revision')::integer;
  answered_at timestamp := (payload->>'answeredAt')::timestamptz AT TIME ZONE 'UTC';
BEGIN
  IF COALESCE(jsonb_typeof(payload->'answers'), 'null') <> 'array' THEN
    RAISE EXCEPTION 'Attendance answers must be an array' USING ERRCODE = '23514';
  END IF;
  IF jsonb_array_length(payload->'answers') > 100 THEN
    RAISE EXCEPTION 'Attendance answers exceed their bound' USING ERRCODE = '23514';
  END IF;
  INSERT INTO attendance_responses (id, "eventId", "guestId", revision, "scopeId", "venueId", status, "respondedAt", "updatedAt")
    SELECT target_guest || ':' || policy_revision || ':' || answer."scopeId", target_event, target_guest, policy_revision,
      answer."scopeId", answer."venueId", answer.status, answered_at, answered_at
    FROM jsonb_to_recordset(payload->'answers') AS answer("scopeId" text, "venueId" text, status "RsvpStatus") ORDER BY answer."scopeId"
    ON CONFLICT ("guestId", revision, "scopeId") DO UPDATE SET status = EXCLUDED.status, "updatedAt" = EXCLUDED."updatedAt"
    WHERE attendance_responses.status IS DISTINCT FROM EXCLUDED.status;
  IF payload->>'mode' = 'PER_VENUE' THEN PERFORM refresh_venue_attendance(target_event, target_guest); END IF;
  RETURN QUERY SELECT r.* FROM rsvps r WHERE r."guestId" = target_guest;
  IF NOT FOUND THEN RAISE EXCEPTION 'No RSVP for attendance write' USING ERRCODE = '23503'; END IF;
END $$;
