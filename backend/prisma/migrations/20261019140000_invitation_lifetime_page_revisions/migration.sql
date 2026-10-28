-- CreateEnum
CREATE TYPE "InvitationLifetimeSource" AS ENUM ('FREE_DEFAULT', 'PLAN', 'LEGACY');

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "expiryProcessedAt" TIMESTAMP(3),
ADD COLUMN     "firstPublishedAt" TIMESTAMP(3),
ADD COLUMN     "lifetimeDays" INTEGER,
ADD COLUMN     "lifetimePlanKey" TEXT,
ADD COLUMN     "lifetimeSource" "InvitationLifetimeSource";

-- CreateTable
CREATE TABLE "guest_page_versions" (
    "eventId" TEXT NOT NULL,
    "revision" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "guest_page_versions_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "guest_page_changes" (
    "eventId" TEXT NOT NULL,
    "transactionId" BIGINT NOT NULL,

    CONSTRAINT "guest_page_changes_pkey" PRIMARY KEY ("eventId","transactionId")
);

-- CreateIndex
CREATE INDEX "invitations_expiresAt_expiryProcessedAt_idx" ON "invitations"("expiresAt", "expiryProcessedAt");

-- CreateIndex
CREATE INDEX "invitations_lifetimeSource_status_idx" ON "invitations"("lifetimeSource", "status");

-- AddForeignKey
ALTER TABLE "guest_page_versions" ADD CONSTRAINT "guest_page_versions_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Published history has no reliable first-publication or original-plan evidence.
-- Keep its current deadline, including indefinite access, until explicitly resolved.
UPDATE invitations SET "lifetimeSource" = 'LEGACY' WHERE status <> 'DRAFT';
INSERT INTO guest_page_versions ("eventId", revision) SELECT id, 0 FROM events;

CREATE FUNCTION record_guest_page_change(p_event text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_event IS NOT NULL THEN
    INSERT INTO guest_page_changes ("eventId", "transactionId") VALUES (p_event, txid_current())
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

CREATE FUNCTION invalidate_guest_page() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  current_row jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
  event_ids text[];
  event_id text;
BEGIN
  IF TG_TABLE_NAME = 'events' THEN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO guest_page_versions ("eventId", revision) VALUES (NEW.id, 0);
    END IF;
    IF TG_OP = 'DELETE' THEN
      DELETE FROM guest_page_changes WHERE "eventId" = OLD.id;
      RETURN NULL;
    END IF;
    event_ids := ARRAY[previous->>'id', current_row->>'id'];
  ELSIF TG_TABLE_NAME = 'design_templates' THEN
    SELECT array_agg(DISTINCT "eventId") INTO event_ids FROM invitations
      WHERE "templateId" IN (previous->>'id', current_row->>'id');
  ELSIF TG_TABLE_NAME IN ('invitation_blocks', 'rsvp_questions') THEN
    SELECT array_agg(DISTINCT "eventId") INTO event_ids FROM invitations
      WHERE id IN (previous->>'invitationId', current_row->>'invitationId');
  ELSIF TG_TABLE_NAME = 'rsvp_answers' THEN
    SELECT array_agg(DISTINCT g."eventId") INTO event_ids FROM guests g JOIN rsvps r ON r."guestId" = g.id
      WHERE r.id IN (previous->>'rsvpId', current_row->>'rsvpId');
  ELSIF TG_TABLE_NAME = 'rsvps' THEN
    SELECT array_agg(DISTINCT "eventId") INTO event_ids FROM guests
      WHERE id IN (previous->>'guestId', current_row->>'guestId');
  ELSE
    event_ids := ARRAY[previous->>'eventId', current_row->>'eventId'];
  END IF;
  FOR event_id IN SELECT DISTINCT value FROM unnest(event_ids) value WHERE value IS NOT NULL LOOP
    PERFORM record_guest_page_change(event_id);
  END LOOP;
  RETURN NULL;
END $$;

-- These also cover raw SQL, workers, bulk imports, cascades and privacy erasure.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['events', 'invitations', 'invitation_blocks', 'rsvp_questions', 'design_templates',
    'media_assets', 'venues', 'timeline_entries', 'households', 'guests', 'rsvps', 'rsvp_answers',
    'attendance_policies', 'attendance_responses', 'tables', 'seats', 'seat_releases', 'seating_arrangements',
    'tickets', 'ticket_orders', 'guest_acknowledgements', 'guest_media'] LOOP
    EXECUTE format('CREATE TRIGGER guest_page_change AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION invalidate_guest_page()', table_name);
  END LOOP;
END $$;

-- Captured duration follows event-date corrections, never today's subscription.
CREATE FUNCTION refresh_invitation_expiry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE invitations SET "expiresAt" = COALESCE(NEW."endsAt", NEW."startsAt") + make_interval(days => "lifetimeDays"),
    "expiryProcessedAt" = NULL
  WHERE "eventId" = NEW.id AND "lifetimeSource" IN ('FREE_DEFAULT', 'PLAN') AND "lifetimeDays" IS NOT NULL
    AND "expiresAt" IS DISTINCT FROM COALESCE(NEW."endsAt", NEW."startsAt") + make_interval(days => "lifetimeDays");
  RETURN NULL;
END $$;
CREATE TRIGGER invitation_date_expiry AFTER UPDATE OF "startsAt", "endsAt" ON events
FOR EACH ROW WHEN ((OLD."startsAt", OLD."endsAt") IS DISTINCT FROM (NEW."startsAt", NEW."endsAt"))
EXECUTE FUNCTION refresh_invitation_expiry();

CREATE FUNCTION rearm_invitation_expiry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" THEN NEW."expiryProcessedAt" := NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invitation_expiry_rearm BEFORE UPDATE OF "expiresAt" ON invitations
FOR EACH ROW EXECUTE FUNCTION rearm_invitation_expiry();
