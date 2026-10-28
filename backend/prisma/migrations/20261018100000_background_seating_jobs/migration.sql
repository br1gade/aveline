-- CreateEnum
CREATE TYPE "SeatingJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE seating_arrangements ADD COLUMN revision INTEGER;
UPDATE seating_arrangements SET revision = 0;
ALTER TABLE seating_arrangements ALTER COLUMN revision SET DEFAULT 0;
ALTER TABLE seating_arrangements ALTER COLUMN revision SET NOT NULL;

-- CreateTable
CREATE TABLE "seating_jobs" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "arrangementId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "SeatingJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failureReason" TEXT,
    "snapshotAt" TIMESTAMP(3),
    "attendanceRevision" INTEGER,
    "arrangementRevision" INTEGER,
    "appliedRevision" INTEGER,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "seating_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seating_jobs_eventId_createdAt_idx" ON "seating_jobs"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "seating_jobs_status_nextAttemptAt_idx" ON "seating_jobs"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "seating_jobs_status_leaseUntil_idx" ON "seating_jobs"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "seating_jobs_arrangementId_idx" ON "seating_jobs"("arrangementId");

-- CreateIndex
CREATE UNIQUE INDEX "seating_jobs_eventId_requestedByUserId_idempotencyKey_key" ON "seating_jobs"("eventId", "requestedByUserId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "seating_jobs" ADD CONSTRAINT "seating_jobs_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seating_jobs" ADD CONSTRAINT "seating_jobs_arrangementId_eventId_fkey" FOREIGN KEY ("arrangementId", "eventId") REFERENCES "seating_arrangements"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- Only one accepted automatic planner may own an arrangement at a time.
CREATE UNIQUE INDEX seating_jobs_active_arrangement_key ON seating_jobs ("arrangementId")
WHERE status IN ('QUEUED', 'RUNNING');

-- Row triggers also cover bulk writes, cascades, ticket cancellation and erasure.
-- Sorted locks keep cross-arrangement invalidations in a consistent order.
CREATE FUNCTION bump_event_seating(p_event text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM seating_arrangements WHERE "eventId" = p_event ORDER BY id FOR UPDATE;
  UPDATE seating_arrangements SET revision = revision + 1 WHERE "eventId" = p_event;
END $$;

CREATE FUNCTION invalidate_seating_inputs() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous jsonb := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  current_row jsonb := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
  event_ids text[];
  scope_ids text[];
  event_id text;
BEGIN
  IF TG_TABLE_NAME IN ('tables', 'seats', 'seat_releases') THEN
    scope_ids := ARRAY[previous->>'arrangementId', current_row->>'arrangementId'];
    PERFORM id FROM seating_arrangements WHERE id = ANY(scope_ids) ORDER BY id FOR UPDATE;
    UPDATE seating_arrangements SET revision = revision + 1 WHERE id = ANY(scope_ids);
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

CREATE TRIGGER seating_tables_revision AFTER INSERT OR UPDATE OR DELETE ON tables
FOR EACH ROW EXECUTE FUNCTION invalidate_seating_inputs();
CREATE TRIGGER seating_seats_revision AFTER INSERT OR UPDATE OR DELETE ON seats
FOR EACH ROW EXECUTE FUNCTION invalidate_seating_inputs();
CREATE TRIGGER seating_releases_revision AFTER INSERT OR UPDATE OR DELETE ON seat_releases
FOR EACH ROW EXECUTE FUNCTION invalidate_seating_inputs();
CREATE TRIGGER seating_guests_revision AFTER INSERT OR UPDATE OR DELETE ON guests
FOR EACH ROW EXECUTE FUNCTION invalidate_seating_inputs();
CREATE TRIGGER seating_rsvps_revision AFTER INSERT OR UPDATE OR DELETE ON rsvps
FOR EACH ROW EXECUTE FUNCTION invalidate_seating_inputs();
CREATE TRIGGER seating_attendance_revision AFTER INSERT OR UPDATE OR DELETE ON attendance_responses
FOR EACH ROW EXECUTE FUNCTION invalidate_seating_inputs();
CREATE TRIGGER seating_venues_revision AFTER INSERT OR UPDATE OR DELETE ON venues
FOR EACH ROW EXECUTE FUNCTION invalidate_seating_inputs();
CREATE TRIGGER seating_timeline_revision AFTER INSERT OR UPDATE OR DELETE ON timeline_entries
FOR EACH ROW EXECUTE FUNCTION invalidate_seating_inputs();
CREATE TRIGGER seating_policy_revision AFTER UPDATE OF status, "attendanceMode", "attendanceRevision" ON events
FOR EACH ROW WHEN ((OLD.status, OLD."attendanceMode", OLD."attendanceRevision") IS DISTINCT FROM
  (NEW.status, NEW."attendanceMode", NEW."attendanceRevision")) EXECUTE FUNCTION invalidate_seating_inputs();
