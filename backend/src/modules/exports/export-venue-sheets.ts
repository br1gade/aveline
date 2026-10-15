import { ExportKind, Prisma } from '@prisma/client';
import { optionLabel } from '../rsvp/rsvp-fields';
import type { Sheet } from './export-sheets';

interface VenueContext { eventId: string; locale: string; kind: ExportKind }
interface CateringRow { venue: string; kind: 'COVERS' | 'DIETARY' | 'NOTE'; value: string | null; quantity: number | null; person: string | null }
interface BarRow { venue: string; drink: string | null; guests: number; share: number }

/** One snapshot query per sheet, with attendance and aggregation in Postgres. */
export async function venueOperationsSheet(tx: Prisma.TransactionClient, context: VenueContext): Promise<Sheet | undefined> {
  const event = await tx.event.findUniqueOrThrow({ where: { id: context.eventId }, select: { invitation: { select: { rsvpFields: true } } } });
  const config = event.invitation?.rsvpFields ?? {};
  if (context.kind === 'CATERING_SHEET') {
    const rows = await cateringRows(tx, context.eventId);
    if (!rows.length) return undefined;
    return { columns: ['Venue', 'Requirement', 'Guests', 'Note'], rows: rows.map((row) => ({ Venue: row.venue,
      Requirement: requirementLabel(row, (key) => optionLabel(config, 'dietary', key, context.locale)),
      Guests: row.quantity ?? row.person, Note: row.kind === 'NOTE' ? row.value : null,
    })) };
  }
  const rows = await barRows(tx, context.eventId);
  if (!rows.length) return undefined;
  return { columns: ['Venue', 'Drink', 'Guests', 'Share %'], rows: rows.map((row) => ({ Venue: row.venue,
    Drink: row.drink === null ? 'No responses' : optionLabel(config, 'drinkPreference', row.drink, context.locale), Guests: row.guests, 'Share %': row.share,
  })) };
}

function requirementLabel(row: CateringRow, label: (key: string) => string): string {
  if (row.kind === 'COVERS') return 'Total covers';
  if (row.kind === 'NOTE') return 'Dietary note';
  return label(row.value ?? '');
}

function eligibleGuests(eventId: string): Prisma.Sql {
  return Prisma.sql`WITH facing AS (
    SELECT v.id, v.name FROM venues v WHERE v."eventId" = ${eventId} AND v.role <> 'PREPARATION'
      AND (NOT EXISTS (SELECT 1 FROM timeline_entries t WHERE t."venueId" = v.id AND t."isInternal")
        OR EXISTS (SELECT 1 FROM timeline_entries t WHERE t."venueId" = v.id AND NOT t."isInternal"))
  ), eligible AS (
    SELECT v.id AS "venueId", g.id, g."firstName", g."lastName", h.name AS household,
      r.dietary, r."dietaryNotes", r."drinkPreference"
    FROM facing v JOIN events e ON e.id = ${eventId} JOIN guests g ON g."eventId" = e.id
    JOIN households h ON h.id = g."householdId" LEFT JOIN rsvps r ON r."guestId" = g.id
    LEFT JOIN attendance_responses a ON a."guestId" = g.id AND a."venueId" = v.id AND a.revision = e."attendanceRevision"
    WHERE (CASE WHEN e."attendanceMode" = 'EVENT_WIDE' THEN r.status ELSE a.status END) = 'ATTENDING'
  )`;
}

function cateringRows(tx: Prisma.TransactionClient, eventId: string): Promise<CateringRow[]> {
  return tx.$queryRaw<CateringRow[]>`${eligibleGuests(eventId)}
    SELECT v.name AS venue, 'COVERS' AS kind, NULL::text AS value, count(g.id)::int AS quantity, NULL::text AS person
      FROM facing v LEFT JOIN eligible g ON g."venueId" = v.id GROUP BY v.id, v.name
    UNION ALL
    SELECT v.name, 'DIETARY', tag, count(*)::int, NULL::text
      FROM eligible g JOIN facing v ON v.id = g."venueId" CROSS JOIN LATERAL unnest(g.dietary) tag GROUP BY v.id, v.name, tag
    UNION ALL
    SELECT v.name, 'NOTE', g."dietaryNotes", NULL::int, concat_ws(' ', g."firstName", g."lastName") || ' (' || g.household || ')'
      FROM eligible g JOIN facing v ON v.id = g."venueId" WHERE g."dietaryNotes" IS NOT NULL AND g."dietaryNotes" <> ''
    ORDER BY venue, kind, value, person`;
}

function barRows(tx: Prisma.TransactionClient, eventId: string): Promise<BarRow[]> {
  return tx.$queryRaw<BarRow[]>`${eligibleGuests(eventId)}
    SELECT v.name AS venue, g."drinkPreference" AS drink, count(g.id)::int AS guests,
      COALESCE(round(100.0 * count(g.id) / NULLIF(sum(count(g.id)) OVER (PARTITION BY v.id), 0)), 0)::int AS share
    FROM facing v LEFT JOIN eligible g ON g."venueId" = v.id AND g."drinkPreference" IS NOT NULL
    GROUP BY v.id, v.name, g."drinkPreference" ORDER BY v.name, guests DESC, drink`;
}
