BEGIN;

-- Some imported legacy answers have no response time. Retain that uncertainty.
ALTER TABLE attendance_responses ALTER COLUMN "respondedAt" DROP NOT NULL;
UPDATE attendance_responses a SET "respondedAt" = r."respondedAt"
FROM rsvps r WHERE a.id = 'legacy:' || r.id
  AND EXISTS (SELECT 1 FROM attendance_policies p WHERE p."eventId" = a."eventId" AND p.revision = a.revision AND p."isActive");

CREATE FUNCTION guard_attendance_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD."eventId", OLD."guestId", OLD.revision, OLD."scopeId", OLD."venueId")
    IS DISTINCT FROM (NEW."eventId", NEW."guestId", NEW.revision, NEW."scopeId", NEW."venueId") THEN
    RAISE EXCEPTION 'Attendance identity cannot change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attendance_identity BEFORE UPDATE ON attendance_responses
FOR EACH ROW EXECUTE FUNCTION guard_attendance_identity();

CREATE FUNCTION guard_attendance_policy_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.id, OLD."eventId", OLD.revision, OLD.mode, OLD."transitionId", OLD."previewToken", OLD."createdAt")
    IS DISTINCT FROM (NEW.id, NEW."eventId", NEW.revision, NEW.mode, NEW."transitionId", NEW."previewToken", NEW."createdAt")
    OR (NOT OLD."isActive" AND NEW."isActive") THEN
    RAISE EXCEPTION 'Attendance policy history cannot change or reopen' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attendance_policy_history BEFORE UPDATE ON attendance_policies
FOR EACH ROW EXECUTE FUNCTION guard_attendance_policy_history();

CREATE FUNCTION guard_active_event_attendance() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD."attendanceMode", OLD."attendanceRevision") IS DISTINCT FROM (NEW."attendanceMode", NEW."attendanceRevision")
    AND NOT EXISTS (SELECT 1 FROM attendance_policies p WHERE p."eventId" = NEW.id
      AND p.revision = NEW."attendanceRevision" AND p.mode = NEW."attendanceMode" AND p."isActive") THEN
    RAISE EXCEPTION 'Event attendance must match the active policy' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER active_event_attendance BEFORE UPDATE ON events
FOR EACH ROW EXECUTE FUNCTION guard_active_event_attendance();

COMMIT;
