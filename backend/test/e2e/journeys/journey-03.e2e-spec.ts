import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BlockType, MessageChannel, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { MessageTransport } from '../../../src/modules/communications/channels/message-channel';
import { SmtpTransport } from '../../../src/modules/communications/channels/smtp.transport';
import { MESSAGE_TRANSPORTS } from '../../../src/modules/communications/communications.module';
import { ExportRunner } from '../../../src/modules/exports/export-runner';
import { SeatingRunner } from '../../../src/modules/seating/jobs/seating-runner';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { MESSAGE_COPY } from '../../../src/seed/message-copy';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Reads an exported CSV the way a spreadsheet would: BOM stripped, CRLF rows, quoted cells. */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.length > 0);
  const [header, ...rows] = lines.map(parseCsvLine);
  return rows.map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] ?? ''])));
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  const pattern = /"((?:[^"]|"")*)"|([^,]*)/g;
  let position = 0;
  while (position <= line.length) {
    pattern.lastIndex = position;
    const match = pattern.exec(line)!;
    cells.push(match[1] !== undefined ? match[1].replace(/""/g, '"') : match[2]);
    position = pattern.lastIndex + 1;
  }
  return cells;
}

function callerFor(app: INestApplication, authorization: string) {
  const http = () => request(app.getHttpServer() as Server);
  return {
    get: (path: string) => http().get(`/api/v1${path}`).set('Authorization', authorization),
    post: (path: string, body: object = {}) => http().post(`/api/v1${path}`).set('Authorization', authorization).send(body),
    patch: (path: string, body: object) => http().patch(`/api/v1${path}`).set('Authorization', authorization).send(body),
  };
}

interface Assignment { venue: string; table: string; isReservation: boolean }
interface TableView { name: string; guests: { name: string }[] }

/**
 * Journey 3: a host changes how guests answer after they already have.
 *
 * An invited wedding with a ceremony and a reception. Guests answer for the
 * whole event over their own links and the host seats and publishes both
 * rooms. The host then switches to per-venue answers: every published seat
 * becomes a flagged reservation, the old reply form is refused, and guests
 * reconfirm venue by venue through the same links. Seating is re-run for
 * each room by the real job runner, and the numbers, the kitchen and bar
 * sheets and the printed files are checked to follow each room's answers.
 * Finally the host switches back to one answer for the event, and the guest
 * page, seating and exports are checked again.
 *
 *   Petrosyan family (3 seats): Armen (link) and Lusine (vegetarian).
 *   Sargsyan (2 seats): Mariam (link), who brings Hayk.
 *   Hakobyan (1 seat): Tigran, who declines, then comes after all.
 *   Avetisyan (1 seat): Ani, who accepts once and never reconfirms.
 */
describe('Journey 3: attendance mode change, reconfirmation, seating and exports (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const http = () => request(app.getHttpServer() as Server);
  const api = (path: string) => `/api/v1${path}`;

  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    // Every worker step is driven in-process; a cron firing mid-journey would race the counts.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    // Platform catalogue a deployment seeds: the template and Aveline's message copy.
    await prisma.designTemplate.create({
      data: { key: 'journey-03', name: 'Journey', allowedFonts: ['Inter'], supportedBlocks: [BlockType.HERO, BlockType.VENUE, BlockType.RSVP] },
    });
    await prisma.messageTemplate.createMany({ data: MESSAGE_COPY.map((template) => ({ ...template, organizationId: null })) });
  });

  afterAll(async () => {
    const email = app.get<Map<MessageChannel, MessageTransport>>(MESSAGE_TRANSPORTS).get(MessageChannel.EMAIL);
    if (email instanceof SmtpTransport) email.close();
    await app.close();
    await disconnectTestDatabase();
  });

  const GUEST_CSV = [
    'First name,Last name,Email,Household,Seats,Locale',
    'Armen,Petrosyan,armen@journey03.test,Petrosyan family,3,en',
    'Lusine,Petrosyan,,Petrosyan family,3,en',
    'Mariam,Sargsyan,mariam@journey03.test,Sargsyan,2,en',
    'Tigran,Hakobyan,tigran@journey03.test,Hakobyan,1,en',
    'Ani,Avetisyan,ani@journey03.test,Avetisyan,1,en',
  ].join('\n');

  /** Event, two rooms with their own tables, choice fields, the guest list, and the invitations sent. */
  const setUpWedding = async () => {
    const { authorization } = await authenticateAs(app, prisma);
    const host = callerFor(app, authorization);
    await host.post('/organizations', { name: 'Anna & Davit' }).expect(201);
    const { body: event } = await host.post('/events', {
      type: 'WEDDING', title: 'Anna & Davit', templateKey: 'journey-03', startsAt: new Date(Date.now() + 30 * DAY_MS).toISOString(),
      timezone: 'Asia/Yerevan', locales: ['en'], defaultLocale: 'en',
    }).expect(201);
    const eventId = event.id as string;
    const slug = event.invitation.slug as string;
    const base = `/events/${eventId}`;
    const venue = async (role: string, name: string) =>
      (await host.post(`${base}/venues`, { role, name, address: `${name}, Yerevan`, capacity: 60 }).expect(201)).body.id as string;
    const church = await venue('CEREMONY', 'Saint Gayane');
    const hall = await venue('RECEPTION', 'Ararat Hall');
    await host.post(`${base}/tables/bulk`, { venueId: church, namePrefix: 'Pew', count: 1, capacity: 6 }).expect(201);
    await host.post(`${base}/tables/bulk`, { venueId: hall, namePrefix: 'Table', count: 2, capacity: 4 }).expect(201);
    await host.patch(`/invitations/${slug}/rsvp-fields`, {
      dietary: { options: [{ key: 'vegetarian', label: { en: 'Vegetarian' } }] },
      drinkPreference: { options: [{ key: 'wine', label: { en: 'Wine' } }, { key: 'cognac', label: { en: 'Cognac' } }] },
    }).expect(200);
    await http().post(api(`${base}/guests/import`)).set('Authorization', authorization)
      .attach('file', Buffer.from(GUEST_CSV), { filename: 'guests.csv', contentType: 'text/csv' })
      .expect(201);
    await host.post(`/invitations/${slug}/publish`).expect(201);
    expect((await host.post(`/invitations/${slug}/send`).expect(201)).body.queued).toBe(4);
    return { host, authorization, eventId, slug, base, church, hall };
  };
  type Wedding = Awaited<ReturnType<typeof setUpWedding>>;

  /** The personal link the invitation email carried. */
  const linkOf = async (wedding: Wedding, toAddress: string) => {
    const message = await prisma.message.findFirstOrThrow({ where: { eventId: wedding.eventId, templateKey: 'invitation.send', toAddress } });
    const match = /\/invitations\/([^/\s]+)\/g\/([^/\s]+)/.exec(message.body)!;
    return `/invitations/${match[1]}/g/${match[2]}`;
  };
  const memberId = async (link: string, firstName: string) => {
    const { body: form } = await http().get(api(`${link}/rsvp`)).expect(200);
    return (form.household.members as { id: string; firstName: string }[]).find((member) => member.firstName === firstName)!.id;
  };
  /** The body is built before the request, so a lookup inside it never overlaps another call. */
  const submit = (link: string, body: object) => http().post(api(`${link}/rsvp`)).send(body);
  const pageOf = async (link: string) => (await http().get(api(link)).expect(200)).body as {
    guest: { attendance: Record<string, unknown>; seating: { assignments: Assignment[]; household: { name: string; assignments: Assignment[] }[] } | null };
  };
  const arrangementOf = async (wedding: Wedding, venueId: string) => {
    const { body } = await wedding.host.get(`${wedding.base}/seating/arrangements`).expect(200);
    return (body as { id: string; venueId: string | null }[]).find((arrangement) => arrangement.venueId === venueId)!.id;
  };
  /** Who sits in a room, by name. */
  const seatedIn = async (wedding: Wedding, venueId: string) => {
    const { body } = await wedding.host.get(`${wedding.base}/tables?arrangementId=${await arrangementOf(wedding, venueId)}`).expect(200);
    return (body as TableView[]).flatMap((table) => table.guests.map((guest) => guest.name)).sort();
  };
  /** The real seating job for one room, run by the worker in-process. */
  const autoSeat = async (wedding: Wedding, venueId: string) => {
    const arrangementId = await arrangementOf(wedding, venueId);
    const { body: job } = await wedding.host.post(`${wedding.base}/seats/auto-assign?arrangementId=${arrangementId}`, { idempotencyKey: randomUUID() }).expect(201);
    expect(await app.get(SeatingRunner).runOne()).toBe(true);
    return (await wedding.host.get(`${wedding.base}/seating/jobs/${job.id as string}`).expect(200)).body as Record<string, unknown>;
  };
  const exportCsv = async (wedding: Wedding, kind: string) => {
    const { body: created } = await wedding.host.post(`${wedding.base}/exports`, { kind, format: 'CSV' }).expect(201);
    return parseCsv((await http().get(created.downloadPath as string).set('Authorization', (wedding.host.get('/').get('Authorization'))).buffer(true).expect(200)).text);
  };
  /** A stored snapshot built by the export worker, which splits operations sheets by venue. */
  const snapshotCsv = async (wedding: Wedding, kind: string) => {
    const { body: snapshot } = await wedding.host.post(`${wedding.base}/export-snapshots`, { kind, format: 'CSV', locale: 'en', idempotencyKey: randomUUID() }).expect(201);
    await app.get(ExportRunner).runOne();
    return parseCsv((await wedding.host.get(`${wedding.base}/export-snapshots/${snapshot.id as string}/download`).buffer(true).expect(200)).text);
  };
  const changePolicy = async (wedding: Wedding, mode: string, expected: Record<string, unknown>) => {
    const { body: preview } = await wedding.host.post(`${wedding.base}/attendance-policy/preview`, { mode }).expect(201);
    expect(preview).toMatchObject(expected);
    const { body: policy } = await wedding.host.post(`${wedding.base}/attendance-policy`, { ...(preview.request as object), transitionId: randomUUID() }).expect(201);
    return policy as { mode: string; revision: number };
  };
  const venuesOf = (assignments: Assignment[]) => assignments.map((assignment) => `${assignment.venue}:${String(assignment.isReservation)}`).sort();

  /** Step 1: event-wide answers over each household's link, both rooms seated and published. */
  const answerForTheEventAndSeat = async (wedding: Wedding) => {
    const armen = await linkOf(wedding, 'armen@journey03.test');
    await submit(armen, {
      status: 'ATTENDING', drinkPreference: 'wine',
      members: [{ guestId: await memberId(armen, 'Lusine'), status: 'ATTENDING', dietary: ['vegetarian'] }],
    }).expect(201);
    const mariam = await linkOf(wedding, 'mariam@journey03.test');
    await submit(mariam, { status: 'ATTENDING', drinkPreference: 'cognac', party: [{ firstName: 'Hayk', lastName: 'Sargsyan' }] }).expect(201);
    await submit(await linkOf(wedding, 'tigran@journey03.test'), { status: 'DECLINED' }).expect(201);
    await submit(await linkOf(wedding, 'ani@journey03.test'), { status: 'ATTENDING' }).expect(201);
    expect((await wedding.host.get(`${wedding.base}/headcount`).expect(200)).body).toMatchObject({ invited: 6, attending: 5, declined: 1, pending: 0 });

    expect(await autoSeat(wedding, wedding.church)).toMatchObject({ status: 'COMPLETED', result: { seated: 5, households: 3, unseated: [] } });
    expect(await autoSeat(wedding, wedding.hall)).toMatchObject({ status: 'COMPLETED', result: { seated: 5, households: 3, unseated: [] } });
    await wedding.host.post(`${wedding.base}/seating/publish`).expect(201);
    const { guest } = await pageOf(armen);
    expect(guest.attendance).toMatchObject({ mode: 'EVENT_WIDE', revision: 1, status: 'ATTENDING' });
    expect(venuesOf(guest.seating!.assignments)).toEqual(['Ararat Hall:false', 'Saint Gayane:false']);
  };

  /** Step 2: per-venue answers; published seats survive as reservations nobody has confirmed. */
  const switchToPerVenue = async (wedding: Wedding) => {
    const policy = await changePolicy(wedding, 'PER_VENUE', {
      mode: 'PER_VENUE', expectedRevision: 1, seatsRetainedAsReservations: true,
      affected: { guests: 6, responses: 6, seatedGuests: 5, seats: 10 },
    });
    expect(policy).toMatchObject({ mode: 'PER_VENUE', revision: 2 });

    const { guest } = await pageOf(await linkOf(wedding, 'armen@journey03.test'));
    expect(guest.attendance).toMatchObject({ mode: 'PER_VENUE', revision: 2, status: 'PENDING', needsReconfirmation: true });
    expect(venuesOf(guest.seating!.assignments)).toEqual(['Ararat Hall:true', 'Saint Gayane:true']);
    // Reservations still occupy the rooms, but nobody is a confirmed cover.
    expect(await seatedIn(wedding, wedding.church)).toHaveLength(5);
    const { body: counts } = await wedding.host.get(`${wedding.base}/headcount`).expect(200);
    expect(counts).toMatchObject({ invited: 6, attending: 0, pending: 6 });
    expect((counts.venues as Record<string, unknown>[]).map((venue) => [venue.venue, venue.attending, venue.pending]))
      .toEqual([['Saint Gayane', 0, 6], ['Ararat Hall', 0, 6]]);
    expect(await exportCsv(wedding, 'PLACE_CARDS')).toEqual([]);
    return policy.revision;
  };

  /** Step 3: the old form is refused; households reconfirm room by room through the same link. */
  const reconfirmPerVenue = async (wedding: Wedding, revision: number) => {
    const at = (church: string, hall: string) => [{ venueId: wedding.church, status: church }, { venueId: wedding.hall, status: hall }];
    const armen = await linkOf(wedding, 'armen@journey03.test');
    expect((await submit(armen, { status: 'ATTENDING' }).expect(409)).body.message).toMatch(/^attendanceRevision:/);
    expect((await submit(armen, { attendanceRevision: 1, venueAttendance: at('ATTENDING', 'ATTENDING') }).expect(409)).body.message)
      .toMatch(/^attendanceRevision:/);

    await submit(armen, {
      attendanceRevision: revision, venueAttendance: at('ATTENDING', 'ATTENDING'),
      members: [{ guestId: await memberId(armen, 'Lusine'), venueAttendance: at('ATTENDING', 'DECLINED') }],
    }).expect(201);
    const mariam = await linkOf(wedding, 'mariam@journey03.test');
    await submit(mariam, {
      attendanceRevision: revision, venueAttendance: at('DECLINED', 'ATTENDING'),
      members: [{ guestId: await memberId(mariam, 'Hayk'), venueAttendance: at('DECLINED', 'ATTENDING') }],
    }).expect(201);
    await submit(await linkOf(wedding, 'tigran@journey03.test'), { attendanceRevision: revision, venueAttendance: at('ATTENDING', 'ATTENDING') }).expect(201);

    // A venue decline gave up only that room's seat; Ani's unconfirmed seats stay held.
    expect(await seatedIn(wedding, wedding.church)).toEqual(['Ani Avetisyan', 'Armen Petrosyan', 'Lusine Petrosyan']);
    expect(await seatedIn(wedding, wedding.hall)).toEqual(['Ani Avetisyan', 'Armen Petrosyan', 'Hayk Sargsyan', 'Mariam Sargsyan']);
    const { guest } = await pageOf(armen);
    expect(guest.attendance).toMatchObject({ status: 'ATTENDING', needsReconfirmation: false });
    const household = new Map(guest.seating!.household.map((member) => [member.name, venuesOf(member.assignments)]));
    expect(household.get('Armen Petrosyan')).toEqual(['Ararat Hall:false', 'Saint Gayane:false']);
    expect(household.get('Lusine Petrosyan')).toEqual(['Saint Gayane:false']);
    const ani = await pageOf(await linkOf(wedding, 'ani@journey03.test'));
    expect(ani.guest.attendance).toMatchObject({ status: 'PENDING', needsReconfirmation: true });
    expect(venuesOf(ani.guest.seating!.assignments)).toEqual(['Ararat Hall:true', 'Saint Gayane:true']);
  };

  /** Step 4: each room's job seats only who said yes to it and has no seat there yet. */
  const reseatEachRoom = async (wedding: Wedding) => {
    expect(await autoSeat(wedding, wedding.church)).toMatchObject({ status: 'COMPLETED', result: { seated: 1, households: 1, unseated: [] } });
    expect(await autoSeat(wedding, wedding.hall)).toMatchObject({ status: 'COMPLETED', result: { seated: 1, households: 1, unseated: [] } });
    expect(await seatedIn(wedding, wedding.church)).toEqual(['Ani Avetisyan', 'Armen Petrosyan', 'Lusine Petrosyan', 'Tigran Hakobyan']);
    expect(await seatedIn(wedding, wedding.hall)).toEqual(['Ani Avetisyan', 'Armen Petrosyan', 'Hayk Sargsyan', 'Mariam Sargsyan', 'Tigran Hakobyan']);
  };

  /** Step 5: numbers, kitchen, bar and printed files follow each room's answers. */
  const operationsFollowEachRoom = async (wedding: Wedding) => {
    const { body: counts } = await wedding.host.get(`${wedding.base}/headcount`).expect(200);
    expect(counts).toMatchObject({ invited: 6, attending: 5, declined: 0, pending: 1 });
    const byVenue = new Map((counts.venues as { venueId: string }[]).map((venue) => [venue.venueId, venue]));
    expect(byVenue.get(wedding.church)).toMatchObject({ attending: 3, declined: 2, pending: 1 });
    expect(byVenue.get(wedding.hall)).toMatchObject({ attending: 4, declined: 1, pending: 1 });

    const sheet = async (name: string, venueId?: string) =>
      (await wedding.host.get(`${wedding.base}/${name}${venueId ? `?venueId=${venueId}` : ''}`).expect(200)).body as Record<string, unknown>;
    expect(await sheet('catering-sheet', wedding.church)).toMatchObject({ covers: 3, requirements: [expect.objectContaining({ key: 'vegetarian', count: 1 })] });
    expect(await sheet('catering-sheet', wedding.hall)).toMatchObject({ covers: 4, requirements: [] });
    expect(await sheet('catering-sheet')).toMatchObject({ covers: 5 });
    const drinks = async (venueId: string) =>
      ((await sheet('bar-sheet', venueId)).preferences as { key: string; guests: number }[]).map((item) => [item.key, item.guests]);
    expect(await drinks(wedding.church)).toEqual([['wine', 1]]);
    expect(await drinks(wedding.hall)).toEqual(expect.arrayContaining([['wine', 1], ['cognac', 1]]));

    const covers = (await snapshotCsv(wedding, 'CATERING_SHEET')).filter((row) => row.Requirement === 'Total covers');
    expect(covers.map((row) => [row.Venue, row.Guests]).sort()).toEqual([['Ararat Hall', '4'], ['Saint Gayane', '3']]);

    const chart = await exportCsv(wedding, 'SEATING_CHART');
    const chartNames = (venue: string) => chart.filter((row) => row.Venue === venue && row.Guest).map((row) => row.Guest).sort();
    expect(chartNames('Saint Gayane')).toEqual(['Ani Avetisyan', 'Armen Petrosyan', 'Lusine Petrosyan', 'Tigran Hakobyan']);
    expect(chartNames('Ararat Hall')).toEqual(['Ani Avetisyan', 'Armen Petrosyan', 'Hayk Sargsyan', 'Mariam Sargsyan', 'Tigran Hakobyan']);
    // A place card per room someone confirmed; Ani's held seats print nothing.
    const cards = (await exportCsv(wedding, 'PLACE_CARDS')).map((row) => `${row.Name}@${row.Venue}`).sort();
    expect(cards).toEqual([
      'Armen Petrosyan@Ararat Hall', 'Armen Petrosyan@Saint Gayane', 'Hayk Sargsyan@Ararat Hall', 'Lusine Petrosyan@Saint Gayane',
      'Mariam Sargsyan@Ararat Hall', 'Tigran Hakobyan@Ararat Hall', 'Tigran Hakobyan@Saint Gayane',
    ]);
  };

  /** Step 6: back to one answer for the event; every seat is a reservation again until reconfirmed. */
  const switchBackToEventWide = async (wedding: Wedding) => {
    const policy = await changePolicy(wedding, 'EVENT_WIDE', { mode: 'EVENT_WIDE', expectedRevision: 2, affected: { guests: 6, seatedGuests: 6, seats: 9 } });
    expect(policy).toMatchObject({ mode: 'EVENT_WIDE', revision: 3 });
    const armen = await linkOf(wedding, 'armen@journey03.test');
    const { guest } = await pageOf(armen);
    expect(guest.attendance).toMatchObject({ mode: 'EVENT_WIDE', revision: 3, status: 'PENDING', needsReconfirmation: true });
    expect(venuesOf(guest.seating!.assignments)).toEqual(['Ararat Hall:true', 'Saint Gayane:true']);
    // Returning to event-wide does not restore old forms, and the per-venue form is now stale.
    await submit(armen, { status: 'ATTENDING' }).expect(409);
    await submit(armen, { attendanceRevision: 2, venueAttendance: [{ venueId: wedding.hall, status: 'ATTENDING' }] }).expect(409);
    expect((await wedding.host.get(`${wedding.base}/headcount`).expect(200)).body).toMatchObject({ attending: 0, pending: 6 });
    expect(await exportCsv(wedding, 'PLACE_CARDS')).toEqual([]);
    expect((await exportCsv(wedding, 'SEATING_CHART')).filter((row) => row.Guest)).toHaveLength(9);
    return policy.revision;
  };

  /** Step 6½: event-wide reconfirmation; a decline frees every room, the job fills the gap. */
  const reconfirmForTheEvent = async (wedding: Wedding, revision: number) => {
    const armen = await linkOf(wedding, 'armen@journey03.test');
    await submit(armen, {
      attendanceRevision: revision, status: 'ATTENDING', members: [{ guestId: await memberId(armen, 'Lusine'), status: 'ATTENDING' }],
    }).expect(201);
    const mariam = await linkOf(wedding, 'mariam@journey03.test');
    await submit(mariam, {
      attendanceRevision: revision, status: 'DECLINED', members: [{ guestId: await memberId(mariam, 'Hayk'), status: 'DECLINED' }],
    }).expect(201);
    expect(await seatedIn(wedding, wedding.hall)).toEqual(['Ani Avetisyan', 'Armen Petrosyan', 'Tigran Hakobyan']);

    expect(await autoSeat(wedding, wedding.hall)).toMatchObject({ status: 'COMPLETED', result: { seated: 1, households: 1, unseated: [] } });
    expect(await autoSeat(wedding, wedding.church)).toMatchObject({ status: 'COMPLETED', result: { seated: 0 } });
    expect(await seatedIn(wedding, wedding.hall)).toEqual(['Ani Avetisyan', 'Armen Petrosyan', 'Lusine Petrosyan', 'Tigran Hakobyan']);

    const { guest } = await pageOf(armen);
    expect(guest.attendance).toMatchObject({ mode: 'EVENT_WIDE', revision: 3, status: 'ATTENDING', needsReconfirmation: false });
    const household = new Map(guest.seating!.household.map((member) => [member.name, venuesOf(member.assignments)]));
    expect(household.get('Lusine Petrosyan')).toEqual(['Ararat Hall:false', 'Saint Gayane:false']);
    const tigran = await pageOf(await linkOf(wedding, 'tigran@journey03.test'));
    expect(venuesOf(tigran.guest.seating!.assignments)).toEqual(['Ararat Hall:true', 'Saint Gayane:true']);

    const { body: counts } = await wedding.host.get(`${wedding.base}/headcount`).expect(200);
    expect(counts).toMatchObject({ attending: 2, declined: 2, pending: 2 });
    expect((counts.venues as Record<string, unknown>[]).map((venue) => venue.attending)).toEqual([2, 2]);
    expect((await wedding.host.get(`${wedding.base}/catering-sheet?venueId=${wedding.hall}`).expect(200)).body)
      .toMatchObject({ covers: 2, requirements: [expect.objectContaining({ key: 'vegetarian', count: 1 })] });
    const cards = (await exportCsv(wedding, 'PLACE_CARDS')).map((row) => `${row.Name}@${row.Venue}`).sort();
    expect(cards).toEqual(['Armen Petrosyan@Ararat Hall', 'Armen Petrosyan@Saint Gayane', 'Lusine Petrosyan@Ararat Hall', 'Lusine Petrosyan@Saint Gayane']);
    const covers = (await snapshotCsv(wedding, 'CATERING_SHEET')).filter((row) => row.Requirement === 'Total covers');
    expect(covers.map((row) => [row.Venue, row.Guests]).sort()).toEqual([['Ararat Hall', '2'], ['Saint Gayane', '2']]);
  };

  /** The host can still see what Armen said under each policy, newest first. */
  const historyKeepsEveryRevision = async (wedding: Wedding) => {
    const { body: households } = await wedding.host.get(`${wedding.base}/guests`).expect(200);
    const armen = (households as { guests: { id: string; firstName: string }[] }[]).flatMap((household) => household.guests).find((person) => person.firstName === 'Armen')!;
    const { body: history } = await wedding.host.get(`${wedding.base}/guests/${armen.id}/attendance-history`).expect(200);
    expect((history as { revision: number; status: string; venue: { name: string } | null; policy: { mode: string } }[])
      .map((record) => [record.revision, record.policy.mode, record.venue?.name ?? 'event', record.status]))
      .toEqual(expect.arrayContaining([
        [3, 'EVENT_WIDE', 'event', 'ATTENDING'], [2, 'PER_VENUE', 'Saint Gayane', 'ATTENDING'], [2, 'PER_VENUE', 'Ararat Hall', 'ATTENDING'],
        [1, 'EVENT_WIDE', 'event', 'ATTENDING'],
      ]));
    return (history as { revision: number }[]).map((record) => record.revision);
  };

  it('moves answered and seated guests to per-venue reconfirmation and back, with seating, counts and exports following each room', async () => {
    const wedding = await setUpWedding();
    await answerForTheEventAndSeat(wedding);
    const perVenue = await switchToPerVenue(wedding);
    await reconfirmPerVenue(wedding, perVenue);
    await reseatEachRoom(wedding);
    await operationsFollowEachRoom(wedding);
    const eventWide = await switchBackToEventWide(wedding);
    await reconfirmForTheEvent(wedding, eventWide);
    expect(await historyKeepsEveryRevision(wedding)).toEqual([3, 2, 2, 1]);
  }, 120_000);
});
