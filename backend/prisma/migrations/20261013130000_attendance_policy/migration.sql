BEGIN;
-- CreateEnum
CREATE TYPE "AttendanceMode" AS ENUM ('EVENT_WIDE', 'PER_VENUE');

-- AlterTable
ALTER TABLE "events" ADD COLUMN     "attendanceMode" "AttendanceMode" DEFAULT 'EVENT_WIDE',
ADD COLUMN     "attendanceRevision" INTEGER DEFAULT 1;

-- CreateTable
CREATE TABLE "attendance_policies" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "mode" "AttendanceMode" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "transitionId" TEXT,
    "previewToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_responses" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "scopeId" TEXT NOT NULL,
    "venueId" TEXT,
    "status" "RsvpStatus" NOT NULL,
    "respondedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_responses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_policies_eventId_revision_key" ON "attendance_policies"("eventId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_policies_eventId_transitionId_key" ON "attendance_policies"("eventId", "transitionId");

-- CreateIndex
CREATE INDEX "attendance_responses_eventId_revision_venueId_status_idx" ON "attendance_responses"("eventId", "revision", "venueId", "status");

-- CreateIndex
CREATE INDEX "attendance_responses_venueId_idx" ON "attendance_responses"("venueId");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_responses_guestId_revision_scopeId_key" ON "attendance_responses"("guestId", "revision", "scopeId");

-- AddForeignKey
ALTER TABLE "attendance_policies" ADD CONSTRAINT "attendance_policies_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_responses" ADD CONSTRAINT "attendance_responses_guestId_eventId_fkey" FOREIGN KEY ("guestId", "eventId") REFERENCES "guests"("id", "eventId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_responses" ADD CONSTRAINT "attendance_responses_eventId_revision_fkey" FOREIGN KEY ("eventId", "revision") REFERENCES "attendance_policies"("eventId", "revision") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_responses" ADD CONSTRAINT "attendance_responses_venueId_eventId_fkey" FOREIGN KEY ("venueId", "eventId") REFERENCES "venues"("id", "eventId") ON DELETE NO ACTION ON UPDATE CASCADE;


-- Legacy answers stay event-wide; no venue answer is invented.
UPDATE events SET "attendanceMode" = 'EVENT_WIDE', "attendanceRevision" = 1;
ALTER TABLE events ALTER COLUMN "attendanceMode" SET NOT NULL;
ALTER TABLE events ALTER COLUMN "attendanceRevision" SET NOT NULL;
ALTER TABLE events ADD CONSTRAINT attendance_revision_positive CHECK ("attendanceRevision" > 0);
INSERT INTO attendance_policies (id, "eventId", revision, mode)
SELECT 'initial:' || id, id, 1, 'EVENT_WIDE' FROM events;
INSERT INTO attendance_responses (id, "eventId", "guestId", revision, "scopeId", status, "respondedAt", "updatedAt")
SELECT 'legacy:' || r.id, g."eventId", g.id, 1, 'event', r.status, COALESCE(r."respondedAt", r."createdAt"), r."updatedAt"
FROM rsvps r JOIN guests g ON g.id = r."guestId" WHERE r.status <> 'PENDING';
CREATE UNIQUE INDEX attendance_one_active_policy ON attendance_policies ("eventId") WHERE "isActive";
ALTER TABLE attendance_responses ADD CONSTRAINT attendance_scope_matches_venue
CHECK (("venueId" IS NULL AND "scopeId" = 'event') OR ("venueId" IS NOT NULL AND "scopeId" = "venueId"));

CREATE FUNCTION create_initial_attendance_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO attendance_policies (id, "eventId", revision, mode)
  VALUES ('initial:' || NEW.id, NEW.id, NEW."attendanceRevision", NEW."attendanceMode");
  RETURN NEW;
END $$;
CREATE TRIGGER event_attendance_policy AFTER INSERT ON events
FOR EACH ROW EXECUTE FUNCTION create_initial_attendance_policy();

CREATE FUNCTION guard_attendance_response() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE policy_mode "AttendanceMode"; is_active boolean;
BEGIN
  SELECT mode, "isActive" INTO policy_mode, is_active FROM attendance_policies
  WHERE "eventId" = NEW."eventId" AND revision = NEW.revision;
  IF NOT is_active THEN RAISE EXCEPTION 'Historical attendance cannot be changed' USING ERRCODE = '23514'; END IF;
  IF (policy_mode = 'EVENT_WIDE') <> (NEW."venueId" IS NULL) THEN
    RAISE EXCEPTION 'Attendance scope does not match policy' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attendance_response_scope BEFORE INSERT OR UPDATE ON attendance_responses
FOR EACH ROW EXECUTE FUNCTION guard_attendance_response();

-- One person is counted once. Unanswered venues are pending, never inferred declines.
CREATE FUNCTION refresh_venue_attendance(target_event text, target_guest text DEFAULT NULL) RETURNS void LANGUAGE sql AS $$
  UPDATE rsvps r SET status = summary.status, "respondedAt" = summary.responded_at, "updatedAt" = CURRENT_TIMESTAMP
  FROM (
    SELECT g.id,
      CASE WHEN bool_or(a.status = 'ATTENDING') THEN 'ATTENDING'
           WHEN count(v.id) = 0 OR count(a.id) < count(v.id) OR bool_or(a.status = 'PENDING') THEN 'PENDING'
           WHEN bool_or(a.status = 'UNDECIDED') THEN 'UNDECIDED'
           ELSE 'DECLINED' END::"RsvpStatus" AS status,
      min(a."respondedAt") AS responded_at
    FROM guests g JOIN events e ON e.id = g."eventId" AND e."attendanceMode" = 'PER_VENUE'
    LEFT JOIN venues v ON v."eventId" = e.id AND v.role <> 'PREPARATION'
      AND (NOT EXISTS (SELECT 1 FROM timeline_entries t WHERE t."venueId" = v.id AND t."isInternal")
        OR EXISTS (SELECT 1 FROM timeline_entries t WHERE t."venueId" = v.id AND NOT t."isInternal"))
    LEFT JOIN attendance_responses a ON a."guestId" = g.id AND a.revision = e."attendanceRevision" AND a."venueId" = v.id
    WHERE e.id = target_event AND (target_guest IS NULL OR g.id = target_guest)
    GROUP BY g.id
  ) summary WHERE r."guestId" = summary.id;
$$;

COMMIT;
