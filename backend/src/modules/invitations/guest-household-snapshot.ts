import { Prisma } from '@prisma/client';
import type { LoadedGuest } from './guest-projection';

interface HouseholdSnapshot {
  household: LoadedGuest['household'];
  event: LoadedGuest['event'];
  payloadRevision: string;
}

/** The payload and its stamp must share a statement snapshot, including during RSVP commits. */
export async function loadHouseholdSnapshots(prisma: Prisma.TransactionClient, eventId: string, ids: string[]): Promise<HouseholdSnapshot[]> {
  if (!ids.length || ids.length > 100) throw new Error('Household projection exceeds its bound');
  // D17 matches GUEST_FACING_VENUES, including exclusively internal timeline venues.
  const rows = await prisma.$queryRaw<HouseholdSnapshot[]>`WITH event_scope AS MATERIALIZED (
    SELECT e.id, guest_payload_revision(e.id, 'shared') AS revision,
      jsonb_build_object('seatingPublishedAt', e."seatingPublishedAt", 'attendanceMode', e."attendanceMode", 'attendanceRevision', e."attendanceRevision",
        'venues', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', v.id, 'name', v.name, 'translations', v.translations) ORDER BY v."sortOrder")
          FROM venues v WHERE v."eventId" = e.id AND v.role <> 'PREPARATION'
            AND (NOT EXISTS (SELECT 1 FROM timeline_entries t WHERE t."venueId" = v.id AND t."isInternal")
              OR EXISTS (SELECT 1 FROM timeline_entries t WHERE t."venueId" = v.id AND NOT t."isInternal"))), '[]'::jsonb)) AS event
    FROM events e WHERE e.id = ${eventId}
  ) SELECT e.event,
    e.revision::text || ':' || h.id || ':' || guest_payload_revision(e.id, 'household:' || h.id)::text AS "payloadRevision",
    jsonb_build_object('name', h.name, 'seatsAllotted', h."seatsAllotted", 'guests', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', g.id, 'firstName', g."firstName", 'lastName', g."lastName", 'locale', g.locale,
        'rsvp', (SELECT jsonb_build_object('status', r.status, 'respondedAt', r."respondedAt") FROM rsvps r WHERE r."guestId" = g.id),
        'attendanceResponses', COALESCE((SELECT jsonb_agg(jsonb_build_object('venueId', a."venueId", 'status', a.status, 'respondedAt', a."respondedAt"))
          FROM attendance_responses a JOIN attendance_policies p ON p."eventId" = a."eventId" AND p.revision = a.revision AND p."isActive"
          WHERE a."guestId" = g.id), '[]'::jsonb),
        'seats', COALESCE((SELECT jsonb_agg(to_jsonb(s) || jsonb_build_object('table', jsonb_build_object('id', t.id, 'name', t.name, 'venueId', t."venueId",
          'venue', CASE WHEN v.id IS NULL THEN NULL ELSE jsonb_build_object('name', v.name, 'translations', v.translations) END)) ORDER BY s.id)
          FROM seats s JOIN tables t ON t.id = s."tableId" LEFT JOIN venues v ON v.id = t."venueId" WHERE s."guestId" = g.id), '[]'::jsonb)) ORDER BY g."isPrimary" DESC)
      FROM guests g WHERE g."householdId" = h.id AND g."eventId" = e.id AND g."anonymizedAt" IS NULL), '[]'::jsonb)) AS household
    FROM households h JOIN event_scope e ON e.id = h."eventId"
    WHERE EXISTS (SELECT 1 FROM guests requested WHERE requested."householdId" = h.id AND requested."eventId" = e.id
      AND requested."anonymizedAt" IS NULL AND requested.id IN (${Prisma.join(ids)}))`;
  return rows.map(restoreDates);
}

function restoreDates(snapshot: HouseholdSnapshot): HouseholdSnapshot {
  snapshot.event.seatingPublishedAt = utcDate(snapshot.event.seatingPublishedAt);
  for (const guest of snapshot.household.guests) {
    if (guest.rsvp) guest.rsvp.respondedAt = utcDate(guest.rsvp.respondedAt);
    for (const answer of guest.attendanceResponses) answer.respondedAt = utcDate(answer.respondedAt);
    for (const seat of guest.seats) seat.assignedAt = utcDate(seat.assignedAt)!;
  }
  return snapshot;
}

function utcDate(value: Date | string | null): Date | null {
  // Prisma DateTime is UTC stored without a timezone; JSON from SQL omits Z.
  return typeof value === 'string' ? new Date(`${value}Z`) : value;
}
