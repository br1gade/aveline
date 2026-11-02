import { ConfigService } from '@nestjs/config';
import { TemplateAdoptionService } from '../../src/modules/design/templates/template-adoption.service';
import { TemplateGatesService } from '../../src/modules/design/templates/template-gates.service';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { ticketEvent, ticketServices } from '../fixtures/tickets.fixture';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AnalyticsService } from '../../src/infra/analytics/analytics.service';
import { OperationsService } from '../../src/modules/operations/operations.service';
import { CacheService } from '../../src/infra/cache/cache.service';
import { StorageService } from '../../src/infra/storage/storage.service';
import { DesignService } from '../../src/modules/design/design.service';
import { VenuesService } from '../../src/modules/design/venues.service';
import { GuestNameService } from '../../src/modules/guests/guest-name.service';
import { TicketSetupService } from '../../src/modules/ticketing/ticket-setup.service';
import { MediaService } from '../../src/modules/media/media.service';
import { ExportSheets } from '../../src/modules/exports/export-sheets';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Guest/design transactions (integration)', () => {
  let prisma: PrismaClient;
  let names: GuestNameService;
  let design: DesignService;
  let venues: VenuesService;
  let setup: TicketSetupService;
  let media: MediaService;
  const cache = { invalidateInvitation: jest.fn().mockResolvedValue(undefined) } as unknown as CacheService;
  beforeAll(() => {
    prisma = testPrisma();
    const database = prisma as unknown as PrismaService;
    names = new GuestNameService(database);
    const gates = new TemplateGatesService(new ConfigService({ TEMPLATE_ADOPTION_ENABLED: 'false' }));
    design = new DesignService(database, cache, new TemplateAdoptionService(database, cache, gates));
    venues = new VenuesService(database, cache);
    setup = new TicketSetupService(database);
    media = new MediaService(database, { removeByUrl: jest.fn().mockResolvedValue(undefined) } as unknown as StorageService, cache);
  });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  it('rejects an erased guest even when their former token is still stored', async () => {
    const { slug, primaryGuestToken } = await seedEvent(prisma);
    await prisma.guest.update({ where: { token: primaryGuestToken }, data: { anonymizedAt: new Date(), firstName: '[erased]' } });
    await expect(names.correct(slug, primaryGuestToken, { firstName: 'New' })).rejects.toBeInstanceOf(NotFoundException);
    expect(await prisma.guest.findUnique({ where: { token: primaryGuestToken } })).toMatchObject({ firstName: '[erased]' });
  });

  it('uses corrected names in new operational exports while preserving a captured sheet', async () => {
    const { slug, eventId, primaryGuestToken } = await seedEvent(prisma);
    await prisma.rsvp.updateMany({ where: { guest: { eventId } }, data: { status: 'ATTENDING' } });
    const sheets = new ExportSheets(prisma, new OperationsService(prisma, {} as AnalyticsService));
    const captured = await sheets.build(eventId, 'PLACE_CARDS');
    await names.correct(slug, primaryGuestToken, { firstName: 'Ани', lastName: 'Dupont' });
    expect(captured.rows[0]).toMatchObject({ Name: 'Primary Guest' });
    expect((await sheets.build(eventId, 'PLACE_CARDS')).rows[0]).toMatchObject({ Name: 'Ани Dupont' });
    expect((await sheets.build(eventId, 'GUEST_LIST')).rows[0]).toMatchObject({ 'First name': 'Ани', 'Last name': 'Dupont' });
  });

  it('uses a corrected linked guest name in new ticket manifests while keeping the checkout capture', async () => {
    const event = await ticketEvent(prisma);
    const services = ticketServices(prisma);
    const order = await services.ticketing.createOrder(event.slug, { buyerName: 'Buyer', buyerEmail: 'buyer@test.local',
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }], attendees: [{ ticketTypeId: event.ticketTypeId, firstName: 'Original' }], idempotencyKey: 'name-correction' });
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.orderId } });
    const guest = await prisma.guest.findUniqueOrThrow({ where: { id: ticket.guestId! } });
    await names.correct(event.invitationSlug, guest.token, { firstName: 'Corrected' });
    const sheets = new ExportSheets(prisma, new OperationsService(prisma, {} as AnalyticsService));
    expect((await sheets.build(event.eventId, 'TICKET_MANIFEST')).rows[0]).toMatchObject({ Holder: 'Corrected' });
    expect(await prisma.orderAttendee.findFirst({ where: { orderId: order.orderId } })).toMatchObject({ firstName: 'Original' });
  });

  it('preserves populated venue profile IDs and links when the old uniqueness index is removed', async () => {
    const migration = await readFile('prisma/migrations/20261018143000_multiple_directory_venues/migration.sql', 'utf8');
    const schema = `migration_${randomUUID().replace(/-/g, '')}`;
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${schema}"`);
      await tx.$executeRawUnsafe('CREATE TABLE venue_profiles (id text PRIMARY KEY, "vendorId" text)');
      await tx.$executeRawUnsafe('CREATE UNIQUE INDEX "venue_profiles_vendorId_key" ON venue_profiles("vendorId")');
      await tx.$executeRawUnsafe("INSERT INTO venue_profiles VALUES ('existing-hall', 'operator')");
      for (const statement of migration.split(';').filter((sql) => sql.trim())) await tx.$executeRawUnsafe(statement);
      await tx.$executeRawUnsafe("INSERT INTO venue_profiles VALUES ('new-hall', 'operator')");
      expect(await tx.$queryRawUnsafe('SELECT * FROM venue_profiles ORDER BY id')).toEqual([
        { id: 'existing-hall', vendorId: 'operator' }, { id: 'new-hall', vendorId: 'operator' },
      ]);
      await tx.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);
    });
  });

  it('rechecks a revoked link after waiting for the guest row lock', async () => {
    const { slug, primaryGuestToken } = await seedEvent(prisma);
    let release = () => undefined as void;
    let locked = () => undefined as void;
    const isLocked = new Promise<void>((resolve) => { locked = resolve; });
    const canRelease = new Promise<void>((resolve) => { release = resolve; });
    const writer = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM guests WHERE token = ${primaryGuestToken} FOR UPDATE`;
      locked();
      await canRelease;
      await tx.guest.update({ where: { token: primaryGuestToken }, data: { token: 'replacement-token' } });
    });
    await isLocked;
    const correction = names.correct(slug, primaryGuestToken, { firstName: 'Intruder' }).catch((error: unknown) => error);
    release();
    await writer;
    expect(await correction).toBeInstanceOf(NotFoundException);
    expect(await prisma.guest.findUnique({ where: { token: 'replacement-token' } })).toMatchObject({ firstName: 'Primary' });
  });

  it('serializes adding/removing questions with complete-order validation', async () => {
    const { slug } = await seedEvent(prisma);
    const first = await design.addQuestion(slug, { type: 'TEXT', prompt: { en: 'First' } });
    const second = await design.addQuestion(slug, { type: 'TEXT', prompt: { en: 'Second' } });
    await design.removeQuestion(slug, second.id);
    await expect(design.reorderQuestions(slug, { expectedOrder: [first.id, second.id], questionIds: [second.id, first.id] })).rejects.toBeInstanceOf(ConflictException);
    const additions = await Promise.all(Array.from({ length: 8 }, (_, i) => design.addQuestion(slug, { type: 'TEXT', prompt: { en: `Question ${i}` } })));
    expect(new Set(additions.map((question) => question.sortOrder)).size).toBe(8);
    expect(await design.listQuestions(slug)).toHaveLength(9);
  });

  it('reassigns one directory hall without changing another or event venue copies', async () => {
    const { eventId } = await seedEvent(prisma);
    const first = await prisma.vendor.create({ data: { name: 'First', category: 'VENUE' } });
    const second = await prisma.vendor.create({ data: { name: 'Second', category: 'VENUE' } });
    const hall = await venues.createProfile({ name: 'Hall', address: 'Old address', vendorId: first.id });
    const other = await venues.createProfile({ name: 'Other hall', address: 'Elsewhere', vendorId: first.id });
    const copy = await venues.create(eventId, { role: 'RECEPTION', name: hall.name, address: hall.address, profileId: hall.id });
    await venues.updateProfile(hall.id, { vendorId: second.id, address: 'New address' });
    expect(await prisma.venueProfile.findUnique({ where: { id: other.id } })).toMatchObject({ vendorId: first.id });
    expect(await prisma.venue.findUnique({ where: { id: copy.id } })).toMatchObject({ address: 'Old address', profileId: hall.id });
    await prisma.vendor.update({ where: { id: second.id }, data: { active: false } });
    expect((await venues.listProfiles()).find((profile) => profile.id === hall.id)).toMatchObject({ vendorId: null, vendor: null });
  });

  it('cannot leave a listing referring to an image removed concurrently', async () => {
    const { eventId } = await seedEvent(prisma);
    const image = await prisma.mediaAsset.create({ data: { eventId, kind: 'PHOTO', url: 'https://media.test/a.png' } });
    const results = await Promise.allSettled([
      setup.upsertListing(eventId, { headline: { en: 'Party' }, heroAssetId: image.id, ogImageId: image.id }),
      media.remove(eventId, image.id),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const listing = await prisma.eventListing.findUnique({ where: { eventId } });
    const remaining = await prisma.mediaAsset.findUnique({ where: { id: image.id } });
    expect(listing?.heroAssetId === image.id).toBe(remaining !== null);
  });
});
