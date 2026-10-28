import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Client } from 'pg';
import { TEST_DATABASE_URL } from '../setup/test-database';
import { assertTestDatabaseUrl } from '../../src/common/test-database-url';

/** Run the historical migrations and populated backfill in an isolated test schema. */
describe('Multi-venue seating migration (integration)', () => {
  it('preserves seat IDs, answers, timestamps and both known/unknown release history', async () => {
    assertTestDatabaseUrl(TEST_DATABASE_URL);
    const connection = new Client({ connectionString: TEST_DATABASE_URL });
    const schema = `seating_migration_${randomUUID().replace(/-/g, '')}`;
    await connection.connect();
    try {
      await connection.query(`CREATE SCHEMA "${schema}"`);
      await connection.query(`SET search_path TO "${schema}"`);
      const folders = (await readdir('prisma/migrations')).filter((name) => /^\d/.test(name)).sort();
      for (const folder of folders.filter((name) => name < '20261013110000_multi_venue_seating')) {
        await connection.query(await readFile(`prisma/migrations/${folder}/migration.sql`, 'utf8'));
      }
      await insertLegacyFixture(connection);
      for (const folder of folders.filter((name) => name >= '20261013110000_multi_venue_seating')) {
        await connection.query(await readFile(`prisma/migrations/${folder}/migration.sql`, 'utf8'));
      }
      const tickets = await connection.query('SELECT id, "guestId", "attendeeId", status, "holderName", "usedAt"::text AS "usedAt" FROM tickets ORDER BY id');
      expect(tickets.rows).toEqual([
        { id: 'legacy-linked', guestId: 'venue', attendeeId: null, status: 'USED', holderName: 'Known holder', usedAt: '2026-10-01 12:00:00' },
        { id: 'legacy-unlinked', guestId: null, attendeeId: null, status: 'VALID', holderName: 'Buyer', usedAt: null },
      ]);
      expect((await connection.query('SELECT count(*)::int AS count FROM order_attendees')).rows).toEqual([{ count: 0 }]);
      expect((await connection.query('SELECT "requestFingerprint", "cancellationStartedAt" FROM ticket_orders')).rows).toEqual([{ requestFingerprint: null, cancellationStartedAt: null }]);
      const seats = await connection.query<{ id: string; arrangementId: string; eventId: string }>('SELECT id, "arrangementId", "eventId" FROM seats ORDER BY id');
      expect(seats.rows).toEqual([
        { id: 'legacy-seat', arrangementId: 'legacy:event', eventId: 'event' },
        { id: 'venue-seat', arrangementId: 'venue:venue', eventId: 'event' },
      ]);
      const releases = await connection.query<{ guestId: string; arrangementId: string; tableId: string | null; releasedAt: string }>('SELECT "guestId", "arrangementId", "tableId", "releasedAt"::text AS "releasedAt" FROM seat_releases ORDER BY "guestId"');
      expect(releases.rows).toEqual([
        { guestId: 'released', arrangementId: 'venue:venue', tableId: 'venue-table', releasedAt: '2026-10-01 12:00:00' },
        { guestId: 'unknown', arrangementId: 'legacy:event', tableId: null, releasedAt: '2026-10-02 12:00:00' },
      ]);
      expect((await connection.query<{ status: string }>('SELECT status FROM rsvps')).rows).toEqual([{ status: 'ATTENDING' }]);
      expect((await connection.query('SELECT "attendanceMode", "attendanceRevision" FROM events')).rows).toEqual([{ attendanceMode: 'EVENT_WIDE', attendanceRevision: 1 }]);
      expect((await connection.query('SELECT "guestId", revision, "scopeId", "venueId", status FROM attendance_responses')).rows).toEqual([
        { guestId: 'venue', revision: 1, scopeId: 'event', venueId: null, status: 'ATTENDING' },
      ]);
      expect((await connection.query('SELECT "respondedAt" FROM attendance_responses')).rows).toEqual([{ respondedAt: null }]);
      expect((await connection.query<{ venueId: string | null }>('SELECT "venueId" FROM tables WHERE id = \'legacy-table\'')).rows).toEqual([{ venueId: null }]);
    } finally {
      await connection.query('ROLLBACK');
      await connection.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await connection.end();
    }
  });
});

async function insertLegacyFixture(connection: Client) {
  await connection.query(`
    INSERT INTO organizations (id, name, kind, "updatedAt") VALUES ('org', 'Fixture', 'HOST', now());
    INSERT INTO events (id, "organizationId", type, title, "hostsLabel", "startsAt", "updatedAt")
      VALUES ('event', 'org', 'WEDDING', 'Fixture', 'Hosts', now(), now());
    INSERT INTO venues (id, "eventId", role, name, address) VALUES ('venue', 'event', 'RECEPTION', 'Hall', 'Address');
    INSERT INTO households (id, "eventId", name) VALUES ('household', 'event', 'Household');
    INSERT INTO guests (id, "eventId", "householdId", "firstName", token, "updatedAt")
      SELECT name, 'event', 'household', name, name, now() FROM unnest(ARRAY['venue', 'legacy', 'released', 'unknown']) name;
    INSERT INTO tables (id, "eventId", "venueId", name, capacity) VALUES
      ('venue-table', 'event', 'venue', 'Dinner', 4), ('legacy-table', 'event', NULL, 'Unknown', 4);
    INSERT INTO seats (id, "guestId", "tableId", position) VALUES
      ('venue-seat', 'venue', 'venue-table', 2), ('legacy-seat', 'legacy', 'legacy-table', 1);
    INSERT INTO rsvps (id, "guestId", status, "updatedAt") VALUES ('answer', 'venue', 'ATTENDING', now());
    INSERT INTO ticket_types (id, "eventId", "priceMinor", "quantityTotal", "updatedAt") VALUES ('type', 'event', 0, 10, now());
    INSERT INTO ticket_orders (id, "eventId", "buyerName", "buyerEmail", "totalMinor", "idempotencyKey", "accessToken", "updatedAt")
      VALUES ('order', 'event', 'Buyer', 'buyer@test.local', 0, 'legacy-key', 'legacy-access', now());
    INSERT INTO tickets (id, "eventId", "orderId", "ticketTypeId", code, "guestId", status, "holderName", "usedAt") VALUES
      ('legacy-linked', 'event', 'order', 'type', 'linked-code', 'venue', 'USED', 'Known holder', '2026-10-01T12:00:00Z'),
      ('legacy-unlinked', 'event', 'order', 'type', 'unlinked-code', NULL, 'VALID', 'Buyer', NULL);
    UPDATE guests SET "seatReleasedAt" = '2026-10-01T12:00:00Z', "seatReleasedFromTableId" = 'venue-table' WHERE id = 'released';
    UPDATE guests SET "seatReleasedAt" = '2026-10-02T12:00:00Z' WHERE id = 'unknown';
  `);
}
