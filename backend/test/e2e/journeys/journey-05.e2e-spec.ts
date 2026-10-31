import type { Server } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { ThrottlerStorage } from '@nestjs/throttler';
import { MessageChannel, PlatformRole, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { SerializeInterceptor } from '../../../src/common/interceptors/serialize';
import { MessageTransport } from '../../../src/modules/communications/channels/message-channel';
import { SmtpTransport } from '../../../src/modules/communications/channels/smtp.transport';
import { MESSAGE_TRANSPORTS } from '../../../src/modules/communications/communications.module';
import { CommunicationsService } from '../../../src/modules/communications/communications.service';
import { ExportRunner } from '../../../src/modules/exports/export-runner';
import { SeatingRunner } from '../../../src/modules/seating/jobs/seating-runner';
import { buildPrivateStorage, PRIVATE_STORAGE, PrivateStorageService } from '../../../src/infra/storage/private/private-storage';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { binaryParser, linkIn, parseCsv, pdfText, seedPlatformDefaults, workbookXml } from '../../fixtures/areas/journey-05.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const DAY_MS = 24 * 60 * 60 * 1000;
const UNTHROTTLED: ThrottlerStorage = {
  increment: () => Promise.resolve({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

interface Ids { eventId: string; slug: string; mainCourseId: string; venueId: string }
interface Snapshot { id: string; kind: string; format: string; locale: string; status: string; downloadPath: string | null; [key: string]: unknown }

/**
 * Journey 5: the fixed files a host hands to the venue, the kitchen and the
 * printer, produced by the export worker from answers guests gave over HTTP
 * and seats the seating worker assigned — then frozen against later edits,
 * and withdrawn when a guest exercises erasure.
 *
 *   Petrosyan family (3 seats): Armen (email) answers for Lusine
 *     (vegetarian) and adds Narek, a plus-one with a nut allergy.
 *   Sargsyan (1 seat): Mariam, imported as "Sargsian", corrects her own
 *     surname through her link and comes.
 *   Hakobyan (1 seat): Tigran declines.
 *   Avetisyan (1 seat): Ani never answers.
 */
describe('Journey 05: RSVPs and seating become fixed worker-made exports, revoked by erasure (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let root: string;

  const http = () => request(app.getHttpServer() as Server);
  const api = (path: string) => `/api/v1${path}`;

  beforeAll(async () => {
    prisma = testPrisma();
    root = await mkdtemp(join(tmpdir(), 'aveline-journey-05-'));
    const storage = buildPrivateStorage(new ConfigService({ S3_ENDPOINT: '', STORAGE_ROOT: join(root, 'public'), PRIVATE_STORAGE_ROOT: join(root, 'private') }));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma)
      .overrideProvider(PRIVATE_STORAGE).useValue(storage)
      // A host's whole week runs here in seconds, from one account, faster than
      // the per-account throttle allows any person; rate-limiting.e2e owns that rule.
      .overrideProvider(ThrottlerStorage).useValue(UNTHROTTLED)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new SerializeInterceptor());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    // Every worker step is driven in-process; a wall-clock cron would race it.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    await seedPlatformDefaults(prisma);
  });

  afterAll(async () => {
    const email = app.get<Map<MessageChannel, MessageTransport>>(MESSAGE_TRANSPORTS).get(MessageChannel.EMAIL);
    if (email instanceof SmtpTransport) email.close();
    await app.close();
    await rm(root, { recursive: true, force: true });
    await disconnectTestDatabase();
  });

  const GUEST_CSV = [
    'First name,Last name,Email,Household,Seats,Locale',
    'Armen,Petrosyan,armen@journey5.test,Petrosyan family,3,en',
    'Lusine,Petrosyan,,Petrosyan family,3,en',
    'Mariam,Sargsian,mariam@journey5.test,Sargsyan,1,en',
    'Tigran,Hakobyan,tigran@journey5.test,Hakobyan,1,en',
    'Ani,Avetisyan,ani@journey5.test,Avetisyan,1,en',
  ].join('\n');

  const registerHost = async () => {
    const email = `host-${randomUUID().slice(0, 8)}@journey5.test`;
    const password = 'a-long-enough-journey-password';
    await http().post(api('/auth/register')).send({ email, password, name: 'Anna Host' }).expect(202);
    const { body: session } = await http().post(api('/auth/login')).send({ email, password }).expect(201);
    const authorization = `Bearer ${session.accessToken as string}`;
    await http().post(api('/organizations')).set('Authorization', authorization).send({ name: 'Anna & Davit', kind: 'HOST' }).expect(201);
    return authorization;
  };

  const createEvent = async (authorization: string, title: string) => {
    const { body: event } = await http().post(api('/events')).set('Authorization', authorization).send({
      type: 'WEDDING', title, templateKey: 'classic', timezone: 'Asia/Yerevan',
      startsAt: new Date(Date.now() + 10 * DAY_MS).toISOString(), locales: ['en', 'hy'], defaultLocale: 'en',
    }).expect(201);
    return { eventId: event.id as string, slug: event.invitation.slug as string };
  };

  /** An event with one question, dietary and drink options, one hall with two tables, and the guest list. */
  const setUpEvent = async (authorization: string): Promise<Ids> => {
    const as = <T extends request.Test>(call: T) => call.set('Authorization', authorization);
    const { eventId, slug } = await createEvent(authorization, 'Anna & Davit');
    await as(http().patch(api(`/invitations/${slug}/rsvp-fields`))).send({
      dietary: { options: [{ key: 'vegetarian', label: { en: 'Vegetarian', hy: 'Բուսակեր' } }] },
      drinkPreference: { options: [{ key: 'wine', label: { en: 'Wine', hy: 'Գինի' } }] },
    }).expect(200);
    const { body: mainCourse } = await as(http().post(api(`/invitations/${slug}/questions`))).send({
      type: 'SINGLE_CHOICE', required: true, prompt: { en: 'Main course', hy: 'Հիմնական ուտեստ' },
      options: { en: ['Meat', 'Fish'], hy: ['Միս', 'Ձուկ'] },
    }).expect(201);
    const { body: venue } = await as(http().post(api(`/events/${eventId}/venues`)))
      .send({ role: 'RECEPTION', name: 'Ararat Hall', address: '1 Abovyan St, Yerevan', capacity: 120 }).expect(201);
    await as(http().post(api(`/events/${eventId}/tables/bulk`))).send({ venueId: venue.id, namePrefix: 'Table', count: 2, capacity: 4 }).expect(201);
    const { body: imported } = await as(http().post(api(`/events/${eventId}/guests/import`)))
      .attach('file', Buffer.from(GUEST_CSV), { filename: 'guests.csv', contentType: 'text/csv' }).expect(201);
    expect(imported).toMatchObject({ status: 'COMPLETED', rowsImported: 5, rowsFailed: 0 });
    return { eventId, slug, mainCourseId: mainCourse.id as string, venueId: venue.id as string };
  };

  /** Publish, send, deliver: each guest's personal link exists only in the message they were sent. */
  const publishAndSend = async (authorization: string, ids: Ids) => {
    await http().post(api(`/invitations/${ids.slug}/publish`)).set('Authorization', authorization).expect(201);
    const { body: sent } = await http().post(api(`/invitations/${ids.slug}/send`)).set('Authorization', authorization).send({}).expect(201);
    expect(sent.queued).toBe(4);
    await app.get(CommunicationsService).dispatchDue();
    const messages = await prisma.message.findMany({ where: { eventId: ids.eventId, templateKey: 'invitation.send' }, select: { toAddress: true, body: true } });
    return new Map(messages.map((message) => {
      const link = linkIn(message.body);
      return [message.toAddress, `/invitations/${link.slug}/g/${link.token}`];
    }));
  };

  /** Guests answer, and one corrects the misspelt surname the host imported. */
  const guestsAnswer = async (ids: Ids, links: Map<string, string>) => {
    const armen = links.get('armen@journey5.test')!;
    const { body: form } = await http().get(api(`${armen}/rsvp`)).expect(200);
    const lusine = (form.household.members as { id: string; firstName: string }[]).find((member) => member.firstName === 'Lusine')!;
    const { body: answer } = await http().post(api(`${armen}/rsvp`)).send({
      status: 'ATTENDING', drinkPreference: 'wine', songRequest: 'Sirun Yar',
      answers: [{ questionId: ids.mainCourseId, value: 0 }],
      members: [{ guestId: lusine.id, status: 'ATTENDING', dietary: ['vegetarian'], answers: [{ questionId: ids.mainCourseId, value: 1 }] }],
      party: [{ firstName: 'Narek', lastName: 'Petrosyan', dietaryNotes: 'severe nut allergy', answers: [{ questionId: ids.mainCourseId, value: 0 }] }],
    }).expect(201);
    expect(answer).toMatchObject({ status: 'ATTENDING', partyAdded: 1, membersAnswered: 1, seatsRemaining: 0 });

    const mariam = links.get('mariam@journey5.test')!;
    const { body: corrected } = await http().patch(api(`${mariam}/name`)).send({ lastName: 'Sargsyan' }).expect(200);
    expect(corrected).toMatchObject({ firstName: 'Mariam', lastName: 'Sargsyan', name: 'Mariam Sargsyan' });
    await http().post(api(`${mariam}/rsvp`)).send({ status: 'ATTENDING', answers: [{ questionId: ids.mainCourseId, value: 1 }] }).expect(201);
    await http().post(api(`${links.get('tigran@journey5.test')!}/rsvp`)).send({ status: 'DECLINED' }).expect(201);
  };

  /** The real seating job seats the four who are coming; the plan is published to guests. */
  const autoSeat = async (authorization: string, ids: Ids) => {
    const { body: arrangements } = await http().get(api(`/events/${ids.eventId}/seating/arrangements`)).set('Authorization', authorization).expect(200);
    const hall = (arrangements as { id: string; venueId: string | null }[]).find((arrangement) => arrangement.venueId === ids.venueId)!;
    const { body: job } = await http().post(api(`/events/${ids.eventId}/seats/auto-assign?arrangementId=${hall.id}`))
      .set('Authorization', authorization).send({ idempotencyKey: randomUUID() }).expect(201);
    expect(await app.get(SeatingRunner).runOne()).toBe(true);
    const { body: done } = await http().get(api(`/events/${ids.eventId}/seating/jobs/${job.id as string}`)).set('Authorization', authorization).expect(200);
    expect(done).toMatchObject({ status: 'COMPLETED', result: { seated: 4, unseated: [] } });
    await http().post(api(`/events/${ids.eventId}/seating/publish`)).set('Authorization', authorization).expect(201);

    const { body: tables } = await http().get(api(`/events/${ids.eventId}/tables?arrangementId=${hall.id}`)).set('Authorization', authorization).expect(200);
    return new Map((tables as { name: string; guests: { name: string }[] }[]).flatMap((table) => table.guests.map((guest): [string, string] => [guest.name, table.name])));
  };

  const snapshots = (eventId: string) => api(`/events/${eventId}/export-snapshots`);

  const queue = async (authorization: string, eventId: string, kind: string, options: { format?: string; locale?: string } = {}) => {
    const { body } = await http().post(snapshots(eventId)).set('Authorization', authorization)
      .send({ kind, format: options.format ?? 'CSV', locale: options.locale ?? 'en', idempotencyKey: randomUUID() }).expect(201);
    expect(body).toMatchObject({ status: 'QUEUED', downloadPath: null });
    return body as Snapshot;
  };

  /** Drains the export queue the way the worker process does, one claim at a time. */
  const runExportWorker = async () => {
    let processed = 0;
    while (await app.get(ExportRunner).runOne()) processed += 1;
    return processed;
  };

  const status = async (authorization: string, eventId: string, id: string) =>
    (await http().get(`${snapshots(eventId)}/${id}`).set('Authorization', authorization).expect(200)).body as Snapshot;

  const download = (authorization: string, eventId: string, id: string) =>
    http().get(`${snapshots(eventId)}/${id}/download`).set('Authorization', authorization).buffer(true).parse(binaryParser);

  const bytesOf = async (authorization: string, eventId: string, id: string) => {
    const file = await download(authorization, eventId, id).expect(200).expect('Cache-Control', 'no-store');
    return file.body as Buffer;
  };

  const csvOf = async (authorization: string, eventId: string, id: string) =>
    parseCsv((await bytesOf(authorization, eventId, id)).toString('utf8'));

  const sha256 = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

  /** The guest list the host prints: every person, their answer, their table and their own words. */
  const expectGuestList = (rows: Record<string, string>[], tableOf: Map<string, string>) => {
    expect(rows.map((row) => `${row['First name']} ${row['Last name']}`).sort())
      .toEqual(['Ani Avetisyan', 'Armen Petrosyan', 'Lusine Petrosyan', 'Mariam Sargsyan', 'Narek Petrosyan', 'Tigran Hakobyan']);
    const row = (firstName: string) => rows.find((candidate) => candidate['First name'] === firstName);
    expect(row('Armen')).toMatchObject({ Email: 'armen@journey5.test', RSVP: 'ATTENDING', Drink: 'wine', Table: tableOf.get('Armen Petrosyan'), 'Q1: Main course': 'Meat' });
    expect(row('Lusine')).toMatchObject({ RSVP: 'ATTENDING', Dietary: 'vegetarian', 'Q1: Main course': 'Fish' });
    // The plus-one added at RSVP is a real person on the list, in the household, with a table.
    expect(row('Narek')).toMatchObject({
      Household: 'Petrosyan family', RSVP: 'ATTENDING', 'Dietary notes': 'severe nut allergy',
      Table: tableOf.get('Narek Petrosyan'), 'Seating by venue': `Ararat Hall: ${tableOf.get('Narek Petrosyan')}`, 'Q1: Main course': 'Meat',
    });
    // The surname the guest typed, not the one the host imported.
    expect(row('Mariam')).toMatchObject({ 'Last name': 'Sargsyan', RSVP: 'ATTENDING', Table: tableOf.get('Mariam Sargsyan') });
    expect(row('Tigran')).toMatchObject({ RSVP: 'DECLINED', Table: '', 'Seating by venue': '' });
    expect(row('Ani')).toMatchObject({ RSVP: 'PENDING', Table: '' });
  };

  /** What the room, the printer and the kitchen are handed agree with the seats just assigned. */
  const expectOperationalSheets = async (authorization: string, eventId: string, jobs: Record<string, Snapshot>, tableOf: Map<string, string>) => {
    const chart = await csvOf(authorization, eventId, jobs.seatingChart.id);
    const seatedRows = chart.filter((row) => row.Guest !== '');
    expect(seatedRows.map((row) => [row.Guest, row.Table]).sort()).toEqual([...tableOf.entries()].sort());
    expect(seatedRows.every((row) => row.Venue === 'Ararat Hall' && row.Capacity === '4')).toBe(true);
    for (const row of seatedRows) expect(row.Seated).toBe(String([...tableOf.values()].filter((table) => table === row.Table).length));

    // One card per attending guest, in surname order; nobody who declined or never answered.
    const cards = await csvOf(authorization, eventId, jobs.placeCards.id);
    expect(cards.map((row) => [row.Name, row.Venue, row.Table])).toEqual(
      ['Armen Petrosyan', 'Lusine Petrosyan', 'Narek Petrosyan', 'Mariam Sargsyan'].map((name) => [name, 'Ararat Hall', tableOf.get(name)]),
    );

    expect(await csvOf(authorization, eventId, jobs.catering.id)).toEqual([
      { Venue: 'Ararat Hall', Requirement: 'Total covers', Guests: '4', Note: '' },
      { Venue: 'Ararat Hall', Requirement: 'Vegetarian', Guests: '1', Note: '' },
      { Venue: 'Ararat Hall', Requirement: 'Dietary note', Guests: 'Narek Petrosyan (Petrosyan family)', Note: 'severe nut allergy' },
    ]);
    expect(await csvOf(authorization, eventId, jobs.playlist.id)).toEqual([{ Track: 'Sirun Yar', Requests: '1' }]);
  };

  /** The same people in the printable and spreadsheet forms, and the guest list in Armenian. */
  const expectOtherFormatsAndLocale = async (authorization: string, eventId: string, jobs: Record<string, Snapshot>, tableOf: Map<string, string>) => {
    const workbook = workbookXml(await bytesOf(authorization, eventId, jobs.placeCardsXlsx.id));
    for (const name of ['Armen Petrosyan', 'Lusine Petrosyan', 'Narek Petrosyan', 'Mariam Sargsyan']) expect(workbook).toContain(name);
    expect(workbook).not.toMatch(/Tigran|Ani Avetisyan|Sargsian/);
    // Six cards to an A4 sheet: four attending guests fit on one page, each
    // card its name over its table and venue, in the same order as the CSV.
    const cards = await bytesOf(authorization, eventId, jobs.placeCardsPdf.id);
    expect(cards.subarray(0, 5).toString()).toBe('%PDF-');
    const pages = pdfText(cards);
    expect(pages).toHaveLength(1);
    const [page] = pages;
    expect(page).toContain('Anna & Davit');
    expect(page.slice(page.indexOf('Armen Petrosyan'))).toEqual(
      ['Armen Petrosyan', 'Lusine Petrosyan', 'Narek Petrosyan', 'Mariam Sargsyan'].flatMap((name) => [name, tableOf.get(name), 'Ararat Hall']),
    );
    expect(page.join('\n')).not.toMatch(/Tigran|Avetisyan|Sargsian/);

    const armenian = await csvOf(authorization, eventId, jobs.guestListHy.id);
    const narek = armenian.find((row) => row['Անուն'] === 'Narek');
    expect(narek).toMatchObject({ 'Ազգանուն': 'Petrosyan', 'Մասնակցության պատասխան': 'Մասնակցելու է', 'Q1: Հիմնական ուտեստ': 'Միս', 'Նշումներ սննդի մասին': 'severe nut allergy' });
  };

  const queueEverything = async (authorization: string, eventId: string) => ({
    guestList: await queue(authorization, eventId, 'GUEST_LIST'),
    seatingChart: await queue(authorization, eventId, 'SEATING_CHART'),
    placeCards: await queue(authorization, eventId, 'PLACE_CARDS'),
    catering: await queue(authorization, eventId, 'CATERING_SHEET'),
    playlist: await queue(authorization, eventId, 'PLAYLIST'),
    placeCardsXlsx: await queue(authorization, eventId, 'PLACE_CARDS', { format: 'XLSX' }),
    placeCardsPdf: await queue(authorization, eventId, 'PLACE_CARDS', { format: 'PDF' }),
    guestListHy: await queue(authorization, eventId, 'GUEST_LIST', { locale: 'hy' }),
  });

  /** An Aveline staff member who works the privacy queue. */
  const privacyOfficer = async () => {
    const { authorization, userId } = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: userId }, data: { platformRole: PlatformRole.ADMIN } });
    return authorization;
  };

  const eraseByRequest = async (subjectEmail: string) => {
    const officer = await privacyOfficer();
    await http().post(api('/privacy/requests')).send({ kind: 'ERASURE', subjectEmail }).expect(201);
    const { body: queueOfRequests } = await http().get(api('/privacy/requests?status=RECEIVED')).set('Authorization', officer).expect(200);
    const requestId = (queueOfRequests as { id: string; subjectEmail: string }[]).find((item) => item.subjectEmail === subjectEmail)!.id;
    await http().patch(api(`/privacy/requests/${requestId}`)).set('Authorization', officer).send({ status: 'IN_PROGRESS' }).expect(200);
    const { body } = await http().post(api(`/privacy/requests/${requestId}/fulfil`)).set('Authorization', officer).expect(201);
    expect(body.guestsAnonymised).toBe(1);
  };

  /** Erasure of one guest withdraws every file of her event, and only of her event. */
  const expectErasureRevokes = async (authorization: string, ids: Ids, made: { jobs: Record<string, Snapshot>; tableOf: Map<string, string> }) => {
    const other = await createEvent(authorization, 'Unrelated party');
    const unrelated = await queue(authorization, other.eventId, 'PLAYLIST');
    await runExportWorker();
    const artifactKeys = (await prisma.exportSnapshot.findMany({ where: { eventId: ids.eventId }, select: { artifactKey: true } })).map((row) => row.artifactKey);
    // Eight first files and the regeneration, every one stored before the request.
    expect(artifactKeys).toHaveLength(9);
    for (const key of artifactKeys) await expect(app.get(PrivateStorageService).get(key!)).resolves.toBeInstanceOf(Buffer);

    await eraseByRequest('mariam@journey5.test');

    for (const job of Object.values(made.jobs)) {
      await download(authorization, ids.eventId, job.id).expect(410);
      expect(await status(authorization, ids.eventId, job.id)).toMatchObject({
        status: 'FAILED', failureReason: 'SUBJECT_ERASED', revokedAt: expect.any(String), downloadPath: null,
        recovery: expect.objectContaining({ code: 'REGENERATE' }),
      });
    }

    // The stored bytes themselves go once cleanup runs, not merely the link to
    // them; the other event's file stays.
    await app.get(ExportRunner).cleanup();
    for (const key of artifactKeys) await expect(app.get(PrivateStorageService).get(key!)).rejects.toThrow();
    expect((await bytesOf(authorization, other.eventId, unrelated.id)).toString('utf8')).toContain('Track');

    // Regenerated, she is "Removed" with her answer and her seat intact, and nothing names her.
    const after = await queue(authorization, ids.eventId, 'GUEST_LIST');
    await runExportWorker();
    const bytes = await bytesOf(authorization, ids.eventId, after.id);
    const removed = parseCsv(bytes.toString('utf8')).find((row) => row['First name'] === 'Removed');
    expect(removed).toMatchObject({ 'Last name': '', Email: '', RSVP: 'ATTENDING', Table: made.tableOf.get('Mariam Sargsyan') });
    expect(bytes.toString('utf8')).not.toMatch(/mariam@journey5\.test|Sargsyan|Sargsian/);
  };

  it('turns HTTP answers and worker seating into fixed exports that match them, survive edits and fall to erasure', async () => {
    const authorization = await registerHost();
    const ids = await setUpEvent(authorization);
    const links = await publishAndSend(authorization, ids);
    await guestsAnswer(ids, links);
    const tableOf = await autoSeat(authorization, ids);
    expect([...tableOf.keys()].sort()).toEqual(['Armen Petrosyan', 'Lusine Petrosyan', 'Mariam Sargsyan', 'Narek Petrosyan']);
    expect(new Set(['Armen Petrosyan', 'Lusine Petrosyan', 'Narek Petrosyan'].map((name) => tableOf.get(name))).size).toBe(1);
    // The guest sees the name she typed and the table the job gave her.
    const { body: mariamPage } = await http().get(api(links.get('mariam@journey5.test')!)).expect(200);
    expect(mariamPage.guest).toMatchObject({ name: 'Mariam Sargsyan', seating: { table: tableOf.get('Mariam Sargsyan') } });

    const jobs = await queueEverything(authorization, ids.eventId);
    // Nothing is rendered in the request: the files exist only once the worker has run.
    await download(authorization, ids.eventId, jobs.guestList.id).expect(409);
    expect(await runExportWorker()).toBe(8);
    for (const job of Object.values(jobs)) {
      expect(await status(authorization, ids.eventId, job.id)).toMatchObject({
        status: 'COMPLETED', attempts: 1, timezone: 'Asia/Yerevan', attendanceRevision: 1,
        downloadPath: `/api/v1/events/${ids.eventId}/export-snapshots/${job.id}/download`,
      });
    }
    const guestListBytes = await bytesOf(authorization, ids.eventId, jobs.guestList.id);
    expectGuestList(parseCsv(guestListBytes.toString('utf8')), tableOf);
    await expectOperationalSheets(authorization, ids.eventId, jobs, tableOf);
    await expectOtherFormatsAndLocale(authorization, ids.eventId, jobs, tableOf);

    // Later edits — the host's and a guest's — leave the fixed file byte-for-byte as it was...
    await http().patch(api(`/events/${ids.eventId}`)).set('Authorization', authorization).send({ title: 'Changed after the snapshot' }).expect(200);
    await http().patch(api(`${links.get('armen@journey5.test')!}/name`)).send({ firstName: 'Armenak' }).expect(200);
    expect(sha256(await bytesOf(authorization, ids.eventId, jobs.guestList.id))).toBe(sha256(guestListBytes));
    // ...while a regeneration, with a new key, captures the event as it is now.
    const regenerated = await queue(authorization, ids.eventId, 'GUEST_LIST');
    await runExportWorker();
    const current = await csvOf(authorization, ids.eventId, regenerated.id);
    expect(current.map((row) => row['First name'])).toContain('Armenak');
    expect(current.map((row) => row['First name'])).not.toContain('Armen');

    await expectErasureRevokes(authorization, ids, { jobs, tableOf });
  }, 180_000);
});
