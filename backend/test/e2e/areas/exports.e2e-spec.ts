import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { EventRole, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { SerializeInterceptor } from '../../../src/common/interceptors/serialize';
import { buildPrivateStorage, PRIVATE_STORAGE } from '../../../src/infra/storage/private/private-storage';
import { ExportRunner } from '../../../src/modules/exports/export-runner';
import { SeatingService } from '../../../src/modules/seating/seating.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { ticketEvent, ticketServices } from '../../fixtures/tickets.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/** Splits a quoted CRLF CSV (BOM-prefixed) into header and data rows. */
function parseCsv(text: string): string[][] {
  return text.replace(/^\uFEFF/u, '').split('\r\n').filter((line) => line !== '')
    .map((line) => line.slice(1, -1).split('","').map((cell) => cell.replace(/""/g, '"')));
}

describe('Exports (e2e coverage)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let root: string;
  const http = () => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    prisma = testPrisma();
    root = await mkdtemp(join(tmpdir(), 'aveline-exports-coverage-'));
    const storage = buildPrivateStorage(new ConfigService({ S3_ENDPOINT: '', STORAGE_ROOT: join(root, 'public'), PRIVATE_STORAGE_ROOT: join(root, 'private') }));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma).overrideProvider(PRIVATE_STORAGE).useValue(storage).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new SerializeInterceptor());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
    await disconnectTestDatabase();
  });

  const owned = async (seeded?: { eventId: string }) => {
    const event = seeded ?? await seedEvent(prisma);
    const owner = await authenticateAs(app, prisma, { eventId: event.eventId, role: EventRole.OWNER });
    await prisma.guest.updateMany({ where: { eventId: event.eventId }, data: { email: 'primary@test.local', phone: '+37410000000' } });
    return { eventId: event.eventId, owner: owner.authorization, base: `/api/v1/events/${event.eventId}` };
  };
  const memberOf = async (eventId: string, role: EventRole) => (await authenticateAs(app, prisma, { eventId, role })).authorization;
  const runWorker = () => app.get(ExportRunner).runOne();
  const snapshot = (base: string, authorization: string, body: Record<string, unknown>) =>
    http().post(`${base}/export-snapshots`).set('Authorization', authorization).send({ idempotencyKey: randomUUID(), ...body });
  const legacy = (base: string, authorization: string, kind: string) =>
    http().post(`${base}/exports`).set('Authorization', authorization).send({ kind });
  const legacyCsv = async (base: string, authorization: string, kind: string) => {
    const { body } = await legacy(base, authorization, kind).expect(201);
    return parseCsv((await http().get(body.downloadPath as string).set('Authorization', authorization).expect(200)).text);
  };

  describe('legacy live CSV kinds', () => {
    /** One attending guest with a drink and a song, seated at a named table. */
    const furnished = async () => {
      const event = await owned();
      const guest = await prisma.guest.findFirstOrThrow({ where: { eventId: event.eventId } });
      await prisma.rsvp.update({ where: { guestId: guest.id }, data: { status: 'ATTENDING', drinkPreference: 'water', songRequest: 'Sirun Yar' } });
      const hall = await prisma.venue.findFirstOrThrow({ where: { eventId: event.eventId } });
      const seating = app.get(SeatingService);
      const table = await seating.createTable(event.eventId, { name: 'Head table', capacity: 8, venueId: hall.id });
      await seating.assign(event.eventId, { guestId: guest.id, tableId: table.id });
      return { ...event, arrangementId: table.arrangementId };
    };

    it('lists every table with its venue, arrangement, capacity and seated guest in the seating chart', async () => {
      const event = await furnished();
      const [header, ...rows] = await legacyCsv(event.base, event.owner, 'SEATING_CHART');
      expect(header).toEqual(['Venue', 'Arrangement', 'Table', 'Capacity', 'Seated', 'Guest']);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(['Fixture Hall', event.arrangementId, 'Head table', '8', '1', 'Primary Guest']);
    });

    it('lists requested tracks with request counts in the playlist', async () => {
      const event = await furnished();
      const [header, ...rows] = await legacyCsv(event.base, event.owner, 'PLAYLIST');
      expect(header).toEqual(['Track', 'Requests']);
      expect(rows).toEqual([['Sirun Yar', '1']]);
    });

    it('lists drink preferences with guest counts and shares in the bar sheet', async () => {
      const event = await furnished();
      const [header, ...rows] = await legacyCsv(event.base, event.owner, 'BAR_SHEET');
      expect(header).toEqual(['Drink', 'Guests', 'Share %']);
      expect(rows).toEqual([['water', '1', '100']]);
    });

    it('lists each paid ticket code with its resolved type name, holder and buyer email in the ticket manifest', async () => {
      const seeded = await ticketEvent(prisma);
      const event = await owned(seeded);
      const order = await ticketServices(prisma).ticketing.createOrder(seeded.slug, { buyerName: 'Buyer', buyerEmail: 'buyer@test.local',
        items: [{ ticketTypeId: seeded.ticketTypeId, quantity: 1 }], attendees: [{ ticketTypeId: seeded.ticketTypeId, firstName: 'Holder' }], idempotencyKey: randomUUID() });
      const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.orderId } });
      const [header, ...rows] = await legacyCsv(event.base, event.owner, 'TICKET_MANIFEST');
      expect(header).toEqual(['Code', 'Type', 'Holder', 'Buyer', 'Buyer email', 'Status', 'Used at']);
      // The type name is translated content: resolved in the event's language, never its raw JSON.
      expect(rows).toEqual([[ticket.code, 'Entry', 'Holder', 'Buyer', 'buyer@test.local', 'VALID', '']]);
    });

    it('names a ticket type in the event language when it is translated into several in the ticket manifest', async () => {
      const seeded = await ticketEvent(prisma);
      const event = await owned(seeded);
      await prisma.ticketType.update({ where: { id: seeded.ticketTypeId }, data: { name: { en: 'Entry', hy: 'Մուտք' } } });
      await ticketServices(prisma).ticketing.createOrder(seeded.slug, { buyerName: 'Buyer', buyerEmail: 'buyer@test.local',
        items: [{ ticketTypeId: seeded.ticketTypeId, quantity: 1 }], attendees: [{ ticketTypeId: seeded.ticketTypeId, firstName: 'Holder' }], idempotencyKey: randomUUID() });
      const [, ...rows] = await legacyCsv(event.base, event.owner, 'TICKET_MANIFEST');
      expect(rows.map((row) => row[1])).toEqual(['Մուտք']);
    });
  });

  describe('legacy read routes need operations:read', () => {
    const routes: [string, (base: string, id: string) => string][] = [
      ['GET list', (base) => `${base}/exports`],
      ['GET one', (base, id) => `${base}/exports/${id}`],
      ['GET download', (base, id) => `${base}/exports/${id}/download`],
    ];

    it.each(routes)('refuses a designer on %s', async (_route, path) => {
      const event = await owned();
      const { body } = await legacy(event.base, event.owner, 'GUEST_LIST').expect(201);
      const designer = await memberOf(event.eventId, EventRole.DESIGNER);
      const refused = await http().get(path(event.base, body.id as string)).set('Authorization', designer).expect(403);
      expect(refused.body.message).toContain('operations:read');
    });

    it.each(routes)('lets a viewer through on %s', async (_route, path) => {
      const event = await owned();
      const { body } = await legacy(event.base, event.owner, 'GUEST_LIST').expect(201);
      const viewer = await memberOf(event.eventId, EventRole.VIEWER);
      await http().get(path(event.base, body.id as string)).set('Authorization', viewer).expect(200);
    });
  });

  describe('snapshot contact visibility', () => {
    it('refuses a viewer who explicitly asks for contact columns, queuing nothing', async () => {
      const event = await owned();
      const viewer = await memberOf(event.eventId, EventRole.VIEWER);
      await snapshot(event.base, viewer, { kind: 'GUEST_LIST', includesContacts: true }).expect(403);
      expect(await prisma.exportSnapshot.count()).toBe(0);
    });

    it('lets a viewer queue an explicitly redacted guest list', async () => {
      const event = await owned();
      const viewer = await memberOf(event.eventId, EventRole.VIEWER);
      const { body } = await snapshot(event.base, viewer, { kind: 'GUEST_LIST', includesContacts: false }).expect(201);
      expect(body).toMatchObject({ includesContacts: false, status: 'QUEUED' });
    });

    it('gives a contact holder who asks for redaction a guest list without email or phone', async () => {
      const event = await owned();
      const created = await snapshot(event.base, event.owner, { kind: 'GUEST_LIST', format: 'CSV', locale: 'en', includesContacts: false }).expect(201);
      expect(created.body).toMatchObject({ includesContacts: false, status: 'QUEUED' });
      await runWorker();
      const file = await http().get(`${event.base}/export-snapshots/${created.body.id as string}/download`).set('Authorization', event.owner).expect(200);
      const [header] = parseCsv(file.text);
      expect(header).toContain('First name');
      expect(header).not.toContain('Email');
      expect(header).not.toContain('Phone');
      expect(file.text).not.toContain('primary@test.local');
      expect(file.text).not.toContain('+37410000000');
    });

    it('refuses to queue a redacted ticket manifest with 400', async () => {
      const event = await owned();
      const { body } = await snapshot(event.base, event.owner, { kind: 'TICKET_MANIFEST', includesContacts: false }).expect(400);
      expect(body.message).toMatch(/cannot be redacted/);
      expect(await prisma.exportSnapshot.count()).toBe(0);
    });
  });

  describe('snapshot read routes need operations:read', () => {
    const routes: [string, (base: string, id: string) => string][] = [
      ['GET list', (base) => `${base}/export-snapshots`],
      ['GET one', (base, id) => `${base}/export-snapshots/${id}`],
      ['GET download', (base, id) => `${base}/export-snapshots/${id}/download`],
    ];
    /** A completed redacted snapshot, so contact permission plays no part in the answer. */
    const completed = async () => {
      const event = await owned();
      const { body } = await snapshot(event.base, event.owner, { kind: 'GUEST_LIST', includesContacts: false }).expect(201);
      expect(await runWorker()).toBe(true);
      return { ...event, id: body.id as string };
    };

    it.each(routes)('refuses a designer on %s', async (_route, path) => {
      const event = await completed();
      const designer = await memberOf(event.eventId, EventRole.DESIGNER);
      const refused = await http().get(path(event.base, event.id)).set('Authorization', designer).expect(403);
      expect(refused.body.message).toContain('operations:read');
    });

    it.each(routes)('lets a viewer through on %s', async (_route, path) => {
      const event = await completed();
      const viewer = await memberOf(event.eventId, EventRole.VIEWER);
      await http().get(path(event.base, event.id)).set('Authorization', viewer).expect(200);
    });
  });

  describe('snapshot expiry', () => {
    const expired = async () => {
      const event = await owned();
      const { body } = await snapshot(event.base, event.owner, { kind: 'GUEST_LIST' }).expect(201);
      await runWorker();
      const path = `${event.base}/export-snapshots/${body.id as string}`;
      const ready = await http().get(path).set('Authorization', event.owner).expect(200);
      expect(ready.body.downloadPath).toBe(`${path}/download`);
      await prisma.exportSnapshot.update({ where: { id: body.id as string }, data: { expiresAt: new Date(0) } });
      return { ...event, path };
    };

    it('reports an expired completed snapshot without a download path', async () => {
      const event = await expired();
      const { body } = await http().get(event.path).set('Authorization', event.owner).expect(200);
      expect(body).toMatchObject({ status: 'COMPLETED', downloadPath: null });
    });

    it('answers 410 for an expired snapshot download', async () => {
      const event = await expired();
      const { body } = await http().get(`${event.path}/download`).set('Authorization', event.owner).expect(410);
      expect(body.message).toMatch(/expired/);
    });

    it('keeps the source event and its guests after expired files are cleaned up', async () => {
      const event = await expired();
      expect(await prisma.exportArtifact.count({ where: { deletedAt: null } })).toBe(1);
      await app.get(ExportRunner).cleanup();
      expect(await prisma.exportArtifact.count({ where: { deletedAt: null } })).toBe(0);
      expect(await prisma.exportArtifact.count()).toBe(1);
      expect(await prisma.event.count({ where: { id: event.eventId } })).toBe(1);
      expect(await prisma.guest.count({ where: { eventId: event.eventId } })).toBe(1);
    });
  });

  describe('snapshot locale', () => {
    /** An event in hy (default) and en, with a translated question answered "Meat". */
    const questioned = async () => {
      const event = await owned();
      const invitation = await prisma.invitation.findFirstOrThrow({ where: { eventId: event.eventId } });
      const meal = await prisma.rsvpQuestion.create({ data: { invitationId: invitation.id, type: 'SINGLE_CHOICE', sortOrder: 0,
        prompt: { hy: 'Միս թե ձուկ', en: 'Meat or fish?' }, options: { hy: ['Միս', 'Ձուկ'], en: ['Meat', 'Fish'] } } });
      const rsvp = await prisma.rsvp.findFirstOrThrow({ where: { guest: { eventId: event.eventId } } });
      await prisma.rsvp.update({ where: { id: rsvp.id }, data: { status: 'ATTENDING' } });
      await prisma.rsvpAnswer.create({ data: { rsvpId: rsvp.id, questionId: meal.id, value: 0 } });
      return event;
    };
    const csvOf = async (event: { base: string; owner: string }, body: Record<string, unknown>) => {
      const created = await snapshot(event.base, event.owner, body).expect(201);
      await runWorker();
      return (await http().get(`${event.base}/export-snapshots/${created.body.id as string}/download`).set('Authorization', event.owner).expect(200)).text;
    };

    it('defaults the snapshot locale to the event language', async () => {
      const event = await owned();
      const { body } = await snapshot(event.base, event.owner, { kind: 'GUEST_LIST' }).expect(201);
      expect(body.locale).toBe('hy');
    });

    it('uses the requested locale for question prompts and choice labels', async () => {
      const csv = await csvOf(await questioned(), { kind: 'GUEST_LIST', locale: 'en' });
      expect(csv).toContain('"Q1: Meat or fish?"');
      expect(csv).toContain('"Meat"');
      expect(csv).not.toContain('Միս');
    });

    it('falls back to the event language for a question the requested locale lacks', async () => {
      const csv = await csvOf(await questioned(), { kind: 'GUEST_LIST', locale: 'fr' });
      expect(csv).toContain('"Q1: Միս թե ձուկ"');
      expect(csv).toContain('"Միս"');
      expect(csv).toContain('"Prénom"');
    });

    it('resolves the ticket-type name in the requested locale, falling back to the event language', async () => {
      const seeded = await ticketEvent(prisma);
      await prisma.ticketType.update({ where: { id: seeded.ticketTypeId }, data: { name: { en: 'Entry', hy: 'Մուտք' } } });
      const event = await owned(seeded);
      await ticketServices(prisma).ticketing.createOrder(seeded.slug, { buyerName: 'Buyer', buyerEmail: 'buyer@test.local',
        items: [{ ticketTypeId: seeded.ticketTypeId, quantity: 1 }], attendees: [{ ticketTypeId: seeded.ticketTypeId, firstName: 'Holder' }], idempotencyKey: randomUUID() });
      const english = await csvOf(event, { kind: 'TICKET_MANIFEST', locale: 'en' });
      expect(english).toContain('"Entry"');
      expect(english).not.toContain('Մուտք');
      const french = await csvOf(event, { kind: 'TICKET_MANIFEST', locale: 'fr' });
      expect(french).toContain('"Մուտք"');
    });
  });
});
