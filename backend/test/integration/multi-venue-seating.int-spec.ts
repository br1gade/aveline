import { PrismaClient } from '@prisma/client';
import { SeatingService } from '../../src/modules/seating/seating.service';
import { recordAnswer } from '../../src/modules/rsvp/answer-writes';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Separate seating at multiple venues (integration)', () => {
  let prisma: PrismaClient;
  let seating: SeatingService;
  beforeAll(() => {
    prisma = testPrisma();
    seating = new SeatingService(prisma as unknown as PrismaService);
  });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  const rooms = async () => {
    const event = await seedEvent(prisma);
    const reception = await prisma.venue.findFirstOrThrow({ where: { eventId: event.eventId } });
    const ceremony = await prisma.venue.create({
      data: { eventId: event.eventId, role: 'CEREMONY', name: 'Church', address: '2 Test St' },
    });
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    return { ...event, reception, ceremony, guest };
  };

  it('allows the same table name at two venues but refuses duplicates in one venue', async () => {
    const { eventId, reception, ceremony } = await rooms();
    await seating.createTable(eventId, { name: 'Table 1', capacity: 2, venueId: reception.id });
    await expect(seating.createTable(eventId, { name: 'Table 1', capacity: 2, venueId: ceremony.id }))
      .resolves.toMatchObject({ venueId: ceremony.id });
    await expect(seating.createTable(eventId, { name: 'Table 1', capacity: 2, venueId: reception.id }))
      .rejects.toThrow();
  });

  it('keeps both seats when assigning the same person at a second venue', async () => {
    const { eventId, reception, ceremony, guest } = await rooms();
    const dinner = await seating.createTable(eventId, { name: 'Dinner', capacity: 2, venueId: reception.id });
    const church = await seating.createTable(eventId, { name: 'Church row', capacity: 2, venueId: ceremony.id });
    await seating.assign(eventId, { guestId: guest.id, tableId: dinner.id });
    await seating.assign(eventId, { guestId: guest.id, tableId: church.id });
    expect(await prisma.seat.count({ where: { guestId: guest.id } })).toBe(2);
  });

  it('moves only the selected venue seat and keeps the other venue assignment', async () => {
    const { eventId, reception, ceremony, guest } = await rooms();
    const dinner = await seating.createTable(eventId, { name: 'Dinner', capacity: 2, venueId: reception.id });
    const church = await seating.createTable(eventId, { name: 'Church row', capacity: 2, venueId: ceremony.id });
    const next = await seating.createTable(eventId, { name: 'Next', capacity: 2, venueId: reception.id });
    await seating.assign(eventId, { guestId: guest.id, tableId: dinner.id });
    await seating.assign(eventId, { guestId: guest.id, tableId: church.id });
    await seating.assign(eventId, { guestId: guest.id, tableId: next.id });
    const seats = await prisma.seat.findMany({ where: { guestId: guest.id } });
    expect(seats.map((seat) => seat.tableId).sort()).toEqual([church.id, next.id].sort());
  });

  const seatedRooms = async () => {
    const fixture = await rooms();
    const dinner = await seating.createTable(fixture.eventId, { name: 'Dinner', capacity: 2, venueId: fixture.reception.id });
    const church = await seating.createTable(fixture.eventId, { name: 'Church row', capacity: 2, venueId: fixture.ceremony.id });
    await seating.assign(fixture.eventId, { guestId: fixture.guest.id, tableId: dinner.id });
    await seating.assign(fixture.eventId, { guestId: fixture.guest.id, tableId: church.id });
    return { ...fixture, dinner, church };
  };

  it('requires a selection before unseating, then removes only the chosen arrangement', async () => {
    const { eventId, guest, dinner, church } = await seatedRooms();
    await expect(seating.unassign(eventId, guest.id)).rejects.toThrow('arrangementId');
    expect(await prisma.seat.count({ where: { guestId: guest.id } })).toBe(2);
    await seating.unassign(eventId, guest.id, dinner.arrangementId);
    expect(await prisma.seat.findMany({ where: { guestId: guest.id } })).toEqual([
      expect.objectContaining({ tableId: church.id }),
    ]);
  });

  it('releases every seat on an event-wide decline and keeps flags independent when reseated', async () => {
    const { eventId, guest, dinner, church } = await seatedRooms();
    await prisma.$transaction((tx) => recordAnswer(tx, guest.id, { status: 'DECLINED' }));
    expect(await prisma.seat.count({ where: { guestId: guest.id } })).toBe(0);
    expect(await prisma.seatRelease.count({ where: { guestId: guest.id } })).toBe(2);
    await seating.assign(eventId, { guestId: guest.id, tableId: dinner.id });
    const remaining = await prisma.seatRelease.findMany({ where: { guestId: guest.id } });
    expect(remaining).toEqual([expect.objectContaining({ arrangementId: church.arrangementId, tableId: church.id })]);
    expect((await seating.listTables(eventId, church.arrangementId))[0].released).toHaveLength(1);
  });

  it('requires a selection for auto-seating and includes already seated people at other venues', async () => {
    const { eventId, guest, dinner, church } = await seatedRooms();
    await seating.unassign(eventId, guest.id, church.arrangementId);
    await prisma.rsvp.update({ where: { guestId: guest.id }, data: { status: 'ATTENDING' } });
    await expect(seating.autoAssign(eventId)).rejects.toThrow('arrangementId');
    expect(await seating.autoAssign(eventId, church.arrangementId)).toMatchObject({ seated: 1 });
    expect(await seating.autoAssign(eventId, church.arrangementId)).toMatchObject({ seated: 0 });
    expect(await prisma.seat.count({ where: { guestId: guest.id, tableId: dinner.id } })).toBe(1);
  });

  it('serializes venue capacity across assignments to different tables', async () => {
    const { eventId, reception, guest, householdId } = await rooms();
    await prisma.venue.update({ where: { id: reception.id }, data: { capacity: 1 } });
    const second = await prisma.guest.create({ data: { eventId, householdId, firstName: 'Second', token: `second-${eventId}` } });
    const firstTable = await seating.createTable(eventId, { name: 'A', capacity: 2, venueId: reception.id });
    const secondTable = await seating.createTable(eventId, { name: 'B', capacity: 2, venueId: reception.id });
    const outcomes = await Promise.allSettled([
      seating.assign(eventId, { guestId: guest.id, tableId: firstTable.id }),
      seating.assign(eventId, { guestId: second.id, tableId: secondTable.id }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.seat.count({ where: { arrangementId: firstTable.arrangementId } })).toBe(1);
  });

  it('rejects table venue changes while seats or decline history remain', async () => {
    const { eventId, guest, dinner, ceremony } = await seatedRooms();
    await expect(seating.updateTable(eventId, dinner.id, { venueId: ceremony.id })).rejects.toThrow('venueId');
    await prisma.$transaction((tx) => recordAnswer(tx, guest.id, { status: 'DECLINED' }));
    await expect(seating.updateTable(eventId, dinner.id, { venueId: null })).rejects.toThrow('venueId');
    await seating.unassign(eventId, guest.id, dinner.arrangementId);
    await expect(seating.updateTable(eventId, dinner.id, { venueId: null })).resolves.toMatchObject({ venueId: null });
  });

  it('refuses a foreign guest and mismatched arrangement even through a direct database writer', async () => {
    const { eventId, dinner, church } = await seatedRooms();
    const foreign = await seedEvent(prisma);
    const foreignGuest = await prisma.guest.findUniqueOrThrow({ where: { token: foreign.primaryGuestToken } });
    await expect(prisma.seat.create({ data: { guestId: foreignGuest.id, tableId: dinner.id } })).rejects.toThrow();
    const household = await prisma.household.findFirstOrThrow({ where: { eventId } });
    const other = await prisma.guest.create({ data: { eventId, householdId: household.id, firstName: 'Other', token: `other-${eventId}` } });
    await expect(prisma.seat.create({ data: { guestId: other.id, tableId: dinner.id, arrangementId: church.arrangementId } })).rejects.toThrow();
  });

  it('keeps a legacy plan distinct and refuses duplicate chairs within one table', async () => {
    const { eventId, guest, householdId } = await rooms();
    const legacy = await seating.createTable(eventId, { name: 'Legacy', capacity: 2 });
    const other = await prisma.guest.create({ data: { eventId, householdId, firstName: 'Other', token: `other-${eventId}` } });
    await seating.assign(eventId, { guestId: guest.id, tableId: legacy.id, position: 1 });
    await expect(seating.assign(eventId, { guestId: other.id, tableId: legacy.id, position: 1 })).rejects.toThrow('position');
    await expect(seating.assign(eventId, { guestId: other.id, tableId: legacy.id, position: 3 })).rejects.toThrow('position');
    expect((await seating.listArrangements(eventId)).find((arrangement) => arrangement.id === legacy.arrangementId)?.venueId).toBeNull();
  });

  it('cascades event deletion without stranding arrangements, seats or release history', async () => {
    const { eventId, guest } = await seatedRooms();
    await prisma.$transaction((tx) => recordAnswer(tx, guest.id, { status: 'DECLINED' }));
    await prisma.event.delete({ where: { id: eventId } });
    expect(await prisma.seatingArrangement.count({ where: { eventId } })).toBe(0);
    expect(await prisma.seatRelease.count({ where: { eventId } })).toBe(0);
  });


  it('creates every requested table when two bulk requests use the same venue and prefix', async () => {
    const { eventId, reception } = await rooms();
    const dto = { namePrefix: 'Table', count: 2, capacity: 4, venueId: reception.id };
    const results = await Promise.all([seating.createTables(eventId, dto), seating.createTables(eventId, dto)]);
    expect(results).toEqual([{ created: 2 }, { created: 2 }]);
    const tables = await prisma.table.findMany({ where: { eventId, venueId: reception.id }, orderBy: { name: 'asc' } });
    expect(tables.map((table) => table.name)).toEqual(['Table 1', 'Table 2', 'Table 3', 'Table 4']);
  });


  it('refuses a smaller table capacity that would strand an existing numbered chair', async () => {
    const { eventId, guest } = await rooms();
    const table = await seating.createTable(eventId, { name: 'Sparse', capacity: 2 });
    await seating.assign(eventId, { guestId: guest.id, tableId: table.id, position: 2 });
    await expect(seating.updateTable(eventId, table.id, { capacity: 1 })).rejects.toThrow('capacity');
    expect(await prisma.seat.count({ where: { tableId: table.id } })).toBe(1);
    expect((await prisma.table.findUniqueOrThrow({ where: { id: table.id } })).capacity).toBe(2);
  });


  it('rejects decline history pointing at another venue or event', async () => {
    const { eventId, guest, dinner, church } = await seatedRooms();
    const foreign = await seedEvent(prisma);
    const otherTable = await prisma.table.create({ data: { eventId: foreign.eventId, name: 'Other', capacity: 2 } });
    for (const table of [church, otherTable]) {
      await expect(prisma.seatRelease.create({ data: {
        guestId: guest.id, eventId, arrangementId: dinner.arrangementId, tableId: table.id, releasedAt: new Date(),
      } })).rejects.toThrow();
    }
  });

  it('preserves arrangement-scoped decline history when an empty table is deleted', async () => {
    const { eventId, guest, dinner } = await seatedRooms();
    await prisma.$transaction((tx) => recordAnswer(tx, guest.id, { status: 'DECLINED' }));
    await seating.deleteTable(eventId, dinner.id);
    expect(await prisma.seatRelease.findUnique({ where: { guestId_arrangementId: { guestId: guest.id, arrangementId: dinner.arrangementId } } }))
      .toMatchObject({ eventId, tableId: null, arrangementId: dinner.arrangementId });
    await seating.unassign(eventId, guest.id, dinner.arrangementId);
    expect(await prisma.seatRelease.count({ where: { arrangementId: dinner.arrangementId } })).toBe(0);
  });

});
