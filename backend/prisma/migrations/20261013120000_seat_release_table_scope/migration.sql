BEGIN;

-- Keep unknown/deleted tables nullable without permitting a cross-event history link.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM seat_releases r JOIN tables t ON t.id = r."tableId"
    WHERE t."eventId" <> r."eventId" OR t."arrangementId" <> r."arrangementId"
  ) THEN
    RAISE EXCEPTION 'Release history has mismatched table/event/arrangement links; review before migrating';
  END IF;
END $$;

CREATE FUNCTION validate_seat_release_table() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE matching_table text;
BEGIN
  IF NEW."tableId" IS NULL THEN RETURN NEW; END IF;
  -- The lock also serializes against a table being moved to a different venue.
  SELECT id INTO matching_table FROM tables
  WHERE id = NEW."tableId" AND "eventId" = NEW."eventId" AND "arrangementId" = NEW."arrangementId"
  FOR SHARE;
  IF matching_table IS NULL THEN
    RAISE EXCEPTION 'Release table does not belong to this event and arrangement' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER seat_releases_table_scope BEFORE INSERT OR UPDATE ON seat_releases
FOR EACH ROW EXECUTE FUNCTION validate_seat_release_table();

COMMIT;
