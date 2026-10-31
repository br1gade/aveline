import { ThrottlerStorage } from '@nestjs/throttler';
import { UNTHROTTLED } from '../../fixtures/unthrottled.fixture';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BlockType, MessageChannel, MessageStatus, PrismaClient } from '@prisma/client';
import type Redis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { MessageTransport } from '../../../src/modules/communications/channels/message-channel';
import { SmtpTransport } from '../../../src/modules/communications/channels/smtp.transport';
import { MESSAGE_TRANSPORTS } from '../../../src/modules/communications/communications.module';
import { CommunicationsService } from '../../../src/modules/communications/communications.service';
import { SeatingRunner } from '../../../src/modules/seating/jobs/seating-runner';
import { REDIS_CLIENT } from '../../../src/infra/cache/cache.service';
import { ReminderSweepService } from '../../../src/infra/jobs/reminder-sweep.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { MESSAGE_COPY } from '../../../src/seed/message-copy';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Platform data a fresh deployment gets from `seed-production`, and nothing
 * else: the classic template a host picks from and Aveline's own message
 * copy. A customer cannot create either, so a journey that starts from
 * registration still needs them in place, exactly as a deployment would.
 */
async function seedPlatformDefaults(prisma: PrismaClient): Promise<void> {
  await prisma.designTemplate.upsert({
    where: { key: 'classic' },
    update: {},
    create: {
      key: 'classic',
      name: 'Classic',
      allowedFonts: ['Noto Serif Armenian', 'Inter'],
      palettes: [
        { name: 'ivory-gold', colors: ['#fffaf0', '#b8860b'] },
        { name: 'blush', colors: ['#f5e1e0', '#b76e79'] },
      ],
      supportedBlocks: [BlockType.HERO, BlockType.VENUE, BlockType.NOTES, BlockType.RSVP],
      blockVariants: { HERO: ['full-bleed', 'split'], RSVP: ['split', 'stacked'] },
      defaultTheme: { bodyFont: 'Noto Serif Armenian', palette: 'ivory-gold' },
    },
  });
  await prisma.messageTemplate.createMany({
    data: MESSAGE_COPY.map((template) => ({ ...template, organizationId: null })),
  });
}

/**
 * Reads the exported CSV the way a spreadsheet would: BOM stripped, CRLF
 * rows, every cell quoted with doubled quotes inside. Returns one record per
 * data row, keyed by the header.
 */
function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, '').split('\r\n').filter((line) => line.length > 0);
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

/** The personal link a sent message carries, as `{ slug, token }`. */
function linkIn(body: string): { slug: string; token: string } {
  const match = /\/invitations\/([^/\s]+)\/g\/([^/\s]+)/.exec(body);
  if (!match) throw new Error(`No personal link in message: ${body}`);
  return { slug: match[1], token: match[2] };
}

/**
 * The host's core loop, end to end, over HTTP only: every step's output is
 * the next step's input. Nothing is inserted behind the API except the
 * platform defaults a deployment seeds and the passage of time.
 *
 * The guest list is small on purpose, so each count asserted below can be
 * traced to a named person:
 *
 *   Petrosyan family (3 seats): Armen (primary, email) and Lusine; Armen adds
 *     Narek as a plus-one when answering for the household.
 *   Sargsyan (2 seats): Mariam, who brings Hayk.
 *   Hakobyan (1 seat): Tigran, who declines — and turns up anyway.
 *   Avetisyan (1 seat): Ani, who answers only after the scheduled reminder.
 *   Nocontact (1 seat): Gor, with no address, so unreachable.
 */
describe('Journey 01: create, design, publish, import, send, RSVP, remind, seat, check in, thank (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const http = () => request(app.getHttpServer() as Server);
  const api = (path: string) => `/api/v1${path}`;

  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ThrottlerStorage).useValue(UNTHROTTLED)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    // Every worker step is driven in-process below; a wall-clock cron firing
    // mid-journey would race the counts.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    await seedPlatformDefaults(prisma);
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  const GUEST_CSV = [
    'First name,Last name,Email,Household,Seats,Side,Locale',
    'Armen,Petrosyan,armen@journey.test,Petrosyan family,3,A,en',
    'Lusine,Petrosyan,,Petrosyan family,3,A,en',
    'Mariam,Sargsyan,mariam@journey.test,Sargsyan,2,B,en',
    'Tigran,Hakobyan,tigran@journey.test,Hakobyan,1,B,en',
    'Ani,Avetisyan,ani@journey.test,Avetisyan,1,both,en',
    'Gor,Nocontact,,Nocontact,1,A,',
  ].join('\n');

  /** Step 1: a stranger registers, signs in and becomes a tenant. */
  const registerHost = async () => {
    const email = 'anna@journey.test';
    const password = 'a-long-enough-journey-password';
    await http().post(api('/auth/register')).send({ email, password, name: 'Anna Host' }).expect(202);
    const { body: session } = await http().post(api('/auth/login')).send({ email, password }).expect(201);
    const authorization = `Bearer ${session.accessToken as string}`;
    const { body: organization } = await http()
      .post(api('/organizations'))
      .set('Authorization', authorization)
      .send({ name: 'Anna & Davit', kind: 'HOST' })
      .expect(201);
    expect(organization).toMatchObject({ name: 'Anna & Davit', members: 1, events: 0 });
    return authorization;
  };

  /** Steps 2–4: the event, its design, its questions, its room. */
  const createAndDesignEvent = async (authorization: string) => {
    const as = <T extends request.Test>(call: T) => call.set('Authorization', authorization);
    const { body: event } = await as(http().post(api('/events'))).send({
      type: 'WEDDING', title: 'Anna & Davit', templateKey: 'classic',
      startsAt: new Date(Date.now() + 10 * DAY_MS).toISOString(),
      locales: ['hy', 'en'], defaultLocale: 'hy',
    }).expect(201);
    expect(event.invitation).toMatchObject({ status: 'DRAFT', theme: { bodyFont: 'Noto Serif Armenian', palette: 'ivory-gold' } });
    const slug = event.invitation.slug as string;

    await as(http().patch(api(`/invitations/${slug}/theme`))).send({ headingFont: 'Inter', palette: 'blush' }).expect(200);
    await as(http().patch(api(`/invitations/${slug}/arrangement`)))
      .send({ blocks: [{ type: 'HERO', variant: 'split' }, { type: 'NOTES', enabled: true }, { type: 'RSVP' }] })
      .expect(200);
    await as(http().patch(api(`/invitations/${slug}/blocks/HERO`)))
      .send({ content: { en: { title: 'Anna & Davit are getting married' }, hy: { title: 'Աննա և Դավիթ' } } })
      .expect(200);
    await as(http().patch(api(`/invitations/${slug}/rsvp-fields`))).send({
      dietary: { options: [{ key: 'vegetarian', label: { en: 'Vegetarian', hy: 'Բուսակեր' } }] },
      drinkPreference: { options: [{ key: 'wine', label: { en: 'Wine', hy: 'Գինի' } }] },
    }).expect(200);
    const { body: mainCourse } = await as(http().post(api(`/invitations/${slug}/questions`))).send({
      type: 'SINGLE_CHOICE', required: true,
      prompt: { en: 'Main course', hy: 'Հիմնական ուտեստ' },
      options: { en: ['Meat', 'Fish'], hy: ['Միս', 'Ձուկ'] },
    }).expect(201);

    const { body: venue } = await as(http().post(api(`/events/${event.id as string}/venues`)))
      .send({ role: 'RECEPTION', name: 'Ararat Hall', address: '1 Abovyan St, Yerevan', capacity: 120 })
      .expect(201);
    await as(http().post(api(`/events/${event.id as string}/tables/bulk`)))
      .send({ venueId: venue.id, namePrefix: 'Table', count: 2, capacity: 4 })
      .expect(201);
    return { eventId: event.id as string, slug, mainCourseId: mainCourse.id as string, venueId: venue.id as string };
  };

  /** Step 5: the spreadsheet, as the host has it. */
  const importGuests = async (authorization: string, eventId: string) => {
    const { body } = await http()
      .post(api(`/events/${eventId}/guests/import`))
      .set('Authorization', authorization)
      .attach('file', Buffer.from(GUEST_CSV), { filename: 'guests.csv', contentType: 'text/csv' })
      .expect(201);
    expect(body).toMatchObject({ status: 'COMPLETED', rowsImported: 6, rowsFailed: 0 });
    const { body: households } = await http().get(api(`/events/${eventId}/guests`)).set('Authorization', authorization).expect(200);
    expect((households as { name: string }[]).map((household) => household.name)).toEqual(['Avetisyan', 'Hakobyan', 'Nocontact', 'Petrosyan family', 'Sargsyan']);
  };

  /** The sent messages of one kind, in address order, and the links they carry. */
  const outbox = async (eventId: string, templateKey: string) => {
    const messages = await prisma.message.findMany({
      where: { eventId, templateKey },
      orderBy: { toAddress: 'asc' },
      select: { toAddress: true, status: true, body: true, locale: true },
    });
    return messages.map((message) => ({ ...message, link: linkIn(message.body) }));
  };

  const linkFor = async (eventId: string, templateKey: string, toAddress: string) => {
    const message = (await outbox(eventId, templateKey)).find((sent) => sent.toAddress === toAddress);
    if (!message) throw new Error(`No ${templateKey} to ${toAddress}`);
    return `/invitations/${message.link.slug}/g/${message.link.token}`;
  };

  /** Step 6–7: publish, send, and let the outbox deliver over SMTP. */
  const publishAndSend = async (authorization: string, ids: { eventId: string; slug: string }) => {
    await http().post(api(`/invitations/${ids.slug}/publish`)).set('Authorization', authorization).expect(201);
    const { body: sent } = await http().post(api(`/invitations/${ids.slug}/send`)).set('Authorization', authorization).send({}).expect(201);
    expect(sent.queued).toBe(4);
    expect((sent.recipients as { toAddress: string }[]).map((recipient) => recipient.toAddress).sort())
      .toEqual(['ani@journey.test', 'armen@journey.test', 'mariam@journey.test', 'tigran@journey.test']);
    expect(sent.unreachable).toEqual([expect.objectContaining({ householdName: 'Nocontact' })]);

    expect(await app.get(CommunicationsService).dispatchDue()).toMatchObject({ sent: 4, failed: 0 });
    const invitations = await outbox(ids.eventId, 'invitation.send');
    expect(invitations.map((message) => message.status)).toEqual(Array(4).fill(MessageStatus.SENT));
    // The guest's own language, and a link to this invitation.
    expect(invitations.every((message) => message.locale === 'en' && message.link.slug === ids.slug)).toBe(true);
  };

  type Ids = Awaited<ReturnType<typeof createAndDesignEvent>>;

  /** Step 8, the Petrosyans: one link answers for the household, and adds a plus-one. */
  const petrosyansAnswer = async (ids: Ids) => {
    const link = await linkFor(ids.eventId, 'invitation.send', 'armen@journey.test');
    const { body: page } = await http().get(api(link)).expect(200);
    expect(page).toMatchObject({
      locale: 'en',
      theme: { bodyFont: 'Noto Serif Armenian', headingFont: 'Inter', palette: 'blush' },
      guest: { name: 'Armen Petrosyan', household: { name: 'Petrosyan family', seatsAllotted: 3 } },
    });
    // Blocks the arrangement left out (the template's VENUE) follow the ones it ordered.
    expect((page.blocks as { type: string }[]).map((block) => block.type)).toEqual(['HERO', 'NOTES', 'RSVP', 'VENUE']);
    expect(page.blocks[3].data).toEqual([expect.objectContaining({ id: ids.venueId, name: 'Ararat Hall' })]);
    expect(page.blocks[0]).toMatchObject({ variant: 'split', content: { title: 'Anna & Davit are getting married' } });
    expect(page.rsvpQuestions).toEqual([expect.objectContaining({ id: ids.mainCourseId, options: ['Meat', 'Fish'] })]);

    const { body: form } = await http().get(api(`${link}/rsvp`)).expect(200);
    const lusine = (form.household.members as { id: string; firstName: string }[]).find((member) => member.firstName === 'Lusine')!;
    const { body: answer } = await http().post(api(`${link}/rsvp`)).send({
      status: 'ATTENDING', drinkPreference: 'wine', songRequest: 'Sirun Yar',
      answers: [{ questionId: ids.mainCourseId, value: 0 }],
      members: [{ guestId: lusine.id, status: 'ATTENDING', dietary: ['vegetarian'], answers: [{ questionId: ids.mainCourseId, value: 1 }] }],
      party: [{ firstName: 'Narek', lastName: 'Petrosyan', dietaryNotes: 'severe nut allergy', answers: [{ questionId: ids.mainCourseId, value: 0 }] }],
    }).expect(201);
    expect(answer).toMatchObject({ status: 'ATTENDING', partyAdded: 1, membersAnswered: 1, seatsRemaining: 0 });
    return link;
  };

  /** Step 8, everyone else who answers before the reminder. */
  const othersAnswer = async (ids: Ids) => {
    const mariam = await linkFor(ids.eventId, 'invitation.send', 'mariam@journey.test');
    await http().post(api(`${mariam}/rsvp`)).send({
      status: 'ATTENDING', songRequest: ' sirun  yar ', answers: [{ questionId: ids.mainCourseId, value: 1 }],
      party: [{ firstName: 'Hayk', lastName: 'Sargsyan', answers: [{ questionId: ids.mainCourseId, value: 1 }] }],
    }).expect(201);

    const tigran = await linkFor(ids.eventId, 'invitation.send', 'tigran@journey.test');
    await http().post(api(`${tigran}/rsvp`)).send({ status: 'DECLINED' }).expect(201);
  };

  /** What the host watches while answers come in. */
  const expectHeadcount = async (authorization: string, eventId: string, counts: Record<string, number>) => {
    const { body } = await http().get(api(`/events/${eventId}/dashboard`)).set('Authorization', authorization).expect(200);
    expect(body.headcount).toMatchObject(counts);
    return body as { headcount: unknown; catering: { covers: number } };
  };

  /** Step 9: the scheduled sweep chases the one household that never answered. */
  const remindAndLateAnswer = async (authorization: string, ids: Ids) => {
    const sweep = app.get(ReminderSweepService);
    // The sweep's lock lives in a Redis shared with every other test process,
    // and a held or stale lock makes the sweep return having done nothing —
    // which would pass the "too soon" check below for the wrong reason.
    const sweepNow = async () => {
      await app.get<Redis>(REDIS_CLIENT).del('aveline:lock:reminders.send');
      await sweep.sendDueReminders();
    };
    await sweepNow();
    // Just invited: too soon to chase anyone.
    expect(await prisma.message.count({ where: { eventId: ids.eventId, templateKey: 'rsvp.reminder' } })).toBe(0);

    // Four days pass since the invitations went out.
    await prisma.message.updateMany({ where: { eventId: ids.eventId, templateKey: 'invitation.send' }, data: { createdAt: new Date(Date.now() - 4 * DAY_MS) } });
    await sweepNow();
    const reminders = await outbox(ids.eventId, 'rsvp.reminder');
    expect(reminders.map((message) => message.toAddress)).toEqual(['ani@journey.test']);

    // The host pressing "remind" the same day sends nobody a second one.
    const { body: manual } = await http().post(api(`/invitations/${ids.slug}/remind`)).set('Authorization', authorization).send({}).expect(201);
    expect(manual).toMatchObject({ queued: 0, alreadyRemindedToday: 1 });
    await app.get(CommunicationsService).dispatchDue();
    expect((await outbox(ids.eventId, 'rsvp.reminder'))[0].status).toBe(MessageStatus.SENT);

    const ani = await linkFor(ids.eventId, 'rsvp.reminder', 'ani@journey.test');
    await http().post(api(`${ani}/rsvp`)).send({ status: 'ATTENDING', answers: [{ questionId: ids.mainCourseId, value: 1 }] }).expect(201);
  };

  /** Step 10: the real seating job, then publishing the plan to guests. */
  const autoSeat = async (authorization: string, ids: Ids) => {
    const { body: arrangements } = await http().get(api(`/events/${ids.eventId}/seating/arrangements`)).set('Authorization', authorization).expect(200);
    const hall = (arrangements as { id: string; venueId: string | null }[]).find((arrangement) => arrangement.venueId === ids.venueId)!;
    const { body: job } = await http()
      .post(api(`/events/${ids.eventId}/seats/auto-assign?arrangementId=${hall.id}`))
      .set('Authorization', authorization)
      .send({ idempotencyKey: randomUUID() })
      .expect(201);
    expect(job.status).toBe('QUEUED');

    expect(await app.get(SeatingRunner).runOne()).toBe(true);
    const { body: done } = await http().get(api(`/events/${ids.eventId}/seating/jobs/${job.id as string}`)).set('Authorization', authorization).expect(200);
    // Armen, Lusine, Narek; Mariam, Hayk; Ani. Tigran declined and Gor never answered.
    expect(done).toMatchObject({ status: 'COMPLETED', result: { seated: 6, households: 3, unseated: [] } });

    const { body: tables } = await http().get(api(`/events/${ids.eventId}/tables?arrangementId=${hall.id}`)).set('Authorization', authorization).expect(200);
    const tableOf = new Map((tables as { name: string; guests: { name: string }[] }[]).flatMap((table) => table.guests.map((guest): [string, string] => [guest.name, table.name])));
    expect([...tableOf.keys()].sort()).toEqual(['Ani Avetisyan', 'Armen Petrosyan', 'Hayk Sargsyan', 'Lusine Petrosyan', 'Mariam Sargsyan', 'Narek Petrosyan']);
    // Households are never split, the plus-one included.
    expect(new Set(['Armen Petrosyan', 'Lusine Petrosyan', 'Narek Petrosyan'].map((name) => tableOf.get(name))).size).toBe(1);
    expect(tableOf.get('Hayk Sargsyan')).toBe(tableOf.get('Mariam Sargsyan'));

    await http().post(api(`/events/${ids.eventId}/seating/publish`)).set('Authorization', authorization).expect(201);
    return tableOf;
  };

  /** A guest sees their own household's tables, and nobody else's. */
  const guestsSeeSeating = async (ids: Ids, tableOf: Map<string, string>) => {
    const { body: armen } = await http().get(api(await linkFor(ids.eventId, 'invitation.send', 'armen@journey.test'))).expect(200);
    expect(armen.guest.seating.table).toBe(tableOf.get('Armen Petrosyan'));
    expect((armen.guest.seating.household as { name: string }[]).map((member) => member.name).sort())
      .toEqual(['Armen Petrosyan', 'Lusine Petrosyan', 'Narek Petrosyan']);
    const { body: mariam } = await http().get(api(await linkFor(ids.eventId, 'invitation.send', 'mariam@journey.test'))).expect(200);
    expect((mariam.guest.seating.household as { name: string }[]).map((member) => member.name).sort()).toEqual(['Hayk Sargsyan', 'Mariam Sargsyan']);
  };

  const exportCsv = async (authorization: string, eventId: string, kind: string) => {
    const { body: created } = await http().post(api(`/events/${eventId}/exports`)).set('Authorization', authorization).send({ kind, format: 'CSV' }).expect(201);
    const { text } = await http().get(created.downloadPath as string).set('Authorization', authorization).buffer(true).expect(200);
    return parseCsv(text);
  };

  /** Step 10½: what the venue, the kitchen and the musician are handed. */
  const exportsCarryTheAnswers = async (authorization: string, ids: Ids, tableOf: Map<string, string>) => {
    const guestList = await exportCsv(authorization, ids.eventId, 'GUEST_LIST');
    const narek = guestList.find((row) => row['First name'] === 'Narek');
    expect(narek).toMatchObject({
      Household: 'Petrosyan family', RSVP: 'ATTENDING', 'Dietary notes': 'severe nut allergy',
      Table: tableOf.get('Narek Petrosyan'), 'Q1: Հիմնական ուտեստ': 'Միս',
    });
    expect(guestList.find((row) => row['First name'] === 'Lusine')).toMatchObject({ Dietary: 'vegetarian', 'Q1: Հիմնական ուտեստ': 'Ձուկ' });
    expect(guestList.find((row) => row['First name'] === 'Tigran')).toMatchObject({ RSVP: 'DECLINED', Table: '' });

    const catering = await exportCsv(authorization, ids.eventId, 'CATERING_SHEET');
    expect(catering).toEqual([
      { Requirement: 'Total covers', Guests: '6', Note: '' },
      { Requirement: 'Բուսակեր', Guests: '1', Note: '' },
      { Requirement: 'Dietary note', Guests: 'Narek Petrosyan (Petrosyan family)', Note: 'severe nut allergy' },
    ]);
    const playlist = await exportCsv(authorization, ids.eventId, 'PLAYLIST');
    expect(playlist).toEqual([{ Track: 'Sirun Yar', Requests: '2' }]);
  };

  const guestId = async (eventId: string, firstName: string) =>
    (await prisma.guest.findFirstOrThrow({ where: { eventId, firstName }, select: { id: true } })).id;

  /** Step 11: the door, on the day. */
  const checkInAtTheDoor = async (authorization: string, ids: Ids, tableOf: Map<string, string>) => {
    const checkIn = async (firstName: string) =>
      (await http().post(api(`/events/${ids.eventId}/guests/${await guestId(ids.eventId, firstName)}/check-in`)).set('Authorization', authorization).expect(201)).body as Record<string, unknown>;

    expect(await checkIn('Armen')).toMatchObject({ name: 'Armen Petrosyan', wasExpected: true, table: tableOf.get('Armen Petrosyan') });
    // The plus-one added at RSVP is a real person at the door, with a table.
    expect(await checkIn('Narek')).toMatchObject({ name: 'Narek Petrosyan', wasExpected: true, table: tableOf.get('Narek Petrosyan') });
    expect(await checkIn('Tigran')).toMatchObject({ name: 'Tigran Hakobyan', wasExpected: false, table: null });

    const { body: arrivals } = await http().get(api(`/events/${ids.eventId}/arrivals`)).set('Authorization', authorization).expect(200);
    expect(arrivals).toMatchObject({ expected: 6, arrived: 3, stillToCome: 4, unexpected: 1 });
  };

  /** Step 12: thanks go to the households someone arrived from, once. */
  const thankArrivals = async (authorization: string, ids: Ids) => {
    await http().patch(api(`/events/${ids.eventId}`)).set('Authorization', authorization)
      .send({ startsAt: new Date(Date.now() - DAY_MS).toISOString(), endsAt: new Date(Date.now() - DAY_MS + 6 * 60 * 60 * 1000).toISOString() })
      .expect(200);
    const thank = () => http().post(api(`/invitations/${ids.slug}/thank-you`)).set('Authorization', authorization).send({}).expect(201);

    const { body: thanks } = await thank();
    expect(thanks).toMatchObject({ basis: 'ARRIVED', queued: 2 });
    expect((thanks.recipients as { toAddress: string }[]).map((recipient) => recipient.toAddress).sort()).toEqual(['armen@journey.test', 'tigran@journey.test']);
    expect((await thank()).body).toMatchObject({ queued: 0, alreadyThanked: 2 });

    await app.get(CommunicationsService).dispatchDue();
    const sent = await outbox(ids.eventId, 'thankyou.send');
    expect(sent.map((message) => [message.toAddress, message.status])).toEqual([
      ['armen@journey.test', MessageStatus.SENT],
      ['tigran@journey.test', MessageStatus.SENT],
    ]);
  };

  it('takes a registered host from an empty account to thanking the guests who came', async () => {
    const authorization = await registerHost();
    const ids = await createAndDesignEvent(authorization);
    await importGuests(authorization, ids.eventId);
    await publishAndSend(authorization, ids);

    await petrosyansAnswer(ids);
    await othersAnswer(ids);
    const dashboard = await expectHeadcount(authorization, ids.eventId, { invited: 8, attending: 5, declined: 1, pending: 2 });
    expect(dashboard.catering.covers).toBe(5);
    // Every submission is acknowledged to the household that made it.
    expect(await prisma.message.count({ where: { eventId: ids.eventId, templateKey: { startsWith: 'rsvp.confirmation.' } } })).toBe(3);

    await remindAndLateAnswer(authorization, ids);
    await expectHeadcount(authorization, ids.eventId, { invited: 8, attending: 6, declined: 1, pending: 1 });

    const tableOf = await autoSeat(authorization, ids);
    await guestsSeeSeating(ids, tableOf);
    await exportsCarryTheAnswers(authorization, ids, tableOf);
    await checkInAtTheDoor(authorization, ids, tableOf);
    await thankArrivals(authorization, ids);
  }, 120_000);

  /**
   * The same loop with two venues answered separately: a ceremony some of the
   * household skip and a reception a plus-one joins only for. Each venue's
   * arrangement is seated by its own job from that venue's answers alone.
   *
   *   Petrosyan family (3 seats): Armen goes to both; Lusine to the ceremony
   *     only; Armen adds Narek, who comes to the reception only.
   *   Sargsyan (1 seat): Mariam skips the ceremony, comes to the reception.
   *   Hakobyan (1 seat): Tigran declines both.
   */
  describe('per venue', () => {
    const PER_VENUE_CSV = [
      'First name,Last name,Email,Household,Seats,Locale',
      'Armen,Petrosyan,armen@journey.test,Petrosyan family,3,en',
      'Lusine,Petrosyan,,Petrosyan family,3,en',
      'Mariam,Sargsyan,mariam@journey.test,Sargsyan,1,en',
      'Tigran,Hakobyan,tigran@journey.test,Hakobyan,1,en',
    ].join('\n');

    interface Venues { eventId: string; slug: string; church: string; hall: string }

    /** Event, two venues each with its own tables, the guest list, and the switch to per-venue answers. */
    const setUpTwoVenues = async (authorization: string): Promise<Venues & { revision: number }> => {
      const as = <T extends request.Test>(call: T) => call.set('Authorization', authorization);
      const { body: event } = await as(http().post(api('/events'))).send({
        type: 'WEDDING', title: 'Anna & Davit', templateKey: 'classic',
        startsAt: new Date(Date.now() + 10 * DAY_MS).toISOString(), locales: ['hy', 'en'], defaultLocale: 'hy',
      }).expect(201);
      const eventId = event.id as string;
      const venue = async (role: string, name: string) =>
        (await as(http().post(api(`/events/${eventId}/venues`))).send({ role, name, address: `${name}, Yerevan`, capacity: 60 }).expect(201)).body.id as string;
      const church = await venue('CEREMONY', 'Saint Gayane');
      const hall = await venue('RECEPTION', 'Ararat Hall');
      await as(http().post(api(`/events/${eventId}/tables/bulk`))).send({ venueId: church, namePrefix: 'Pew', count: 1, capacity: 6 }).expect(201);
      await as(http().post(api(`/events/${eventId}/tables/bulk`))).send({ venueId: hall, namePrefix: 'Table', count: 2, capacity: 4 }).expect(201);
      await as(http().post(api(`/events/${eventId}/guests/import`)))
        .attach('file', Buffer.from(PER_VENUE_CSV), { filename: 'guests.csv', contentType: 'text/csv' })
        .expect(201);

      const { body: preview } = await as(http().post(api(`/events/${eventId}/attendance-policy/preview`))).send({ mode: 'PER_VENUE' }).expect(201);
      expect(preview).toMatchObject({ mode: 'PER_VENUE', expectedRevision: 1, affected: { guests: 4 } });
      const { body: policy } = await as(http().post(api(`/events/${eventId}/attendance-policy`)))
        .send({ ...preview.request, transitionId: randomUUID() })
        .expect(201);
      expect(policy).toMatchObject({ mode: 'PER_VENUE', revision: 2 });
      return { eventId, slug: event.invitation.slug as string, church, hall, revision: policy.revision as number };
    };

    const publishAndSendTo = async (authorization: string, venues: Venues) => {
      await http().post(api(`/invitations/${venues.slug}/publish`)).set('Authorization', authorization).expect(201);
      const { body: sent } = await http().post(api(`/invitations/${venues.slug}/send`)).set('Authorization', authorization).send({}).expect(201);
      expect(sent.queued).toBe(3);
      expect(await app.get(CommunicationsService).dispatchDue()).toMatchObject({ sent: 3, failed: 0 });
    };

    /** Guests answer each venue through the link they were sent. */
    const answerPerVenue = async (venues: Venues & { revision: number }) => {
      const armen = await linkFor(venues.eventId, 'invitation.send', 'armen@journey.test');
      const { body: page } = await http().get(api(armen)).expect(200);
      expect(page.guest.attendance).toMatchObject({ mode: 'PER_VENUE', revision: venues.revision, status: 'PENDING' });
      expect((page.guest.attendance.venues as { venue: string }[]).map((venue) => venue.venue).sort()).toEqual(['Ararat Hall', 'Saint Gayane']);
      const { body: form } = await http().get(api(`${armen}/rsvp`)).expect(200);
      const lusine = (form.household.members as { id: string; firstName: string }[]).find((member) => member.firstName === 'Lusine')!;
      const at = (church: string, hall: string) => [{ venueId: venues.church, status: church }, { venueId: venues.hall, status: hall }];
      await http().post(api(`${armen}/rsvp`)).send({
        attendanceRevision: venues.revision, venueAttendance: at('ATTENDING', 'ATTENDING'),
        members: [{ guestId: lusine.id, venueAttendance: at('ATTENDING', 'DECLINED') }],
        party: [{ firstName: 'Narek', lastName: 'Petrosyan', dietary: ['vegetarian'], venueAttendance: at('DECLINED', 'ATTENDING') }],
      }).expect(201);

      const mariam = await linkFor(venues.eventId, 'invitation.send', 'mariam@journey.test');
      await http().post(api(`${mariam}/rsvp`)).send({ attendanceRevision: venues.revision, venueAttendance: at('DECLINED', 'ATTENDING') }).expect(201);
      const tigran = await linkFor(venues.eventId, 'invitation.send', 'tigran@journey.test');
      await http().post(api(`${tigran}/rsvp`)).send({ attendanceRevision: venues.revision, venueAttendance: at('DECLINED', 'DECLINED') }).expect(201);
    };

    /** The host's per-venue numbers: who is coming where, and what each kitchen cooks. */
    const expectVenueHeadcounts = async (authorization: string, venues: Venues) => {
      const { body: dashboard } = await http().get(api(`/events/${venues.eventId}/dashboard`)).set('Authorization', authorization).expect(200);
      const byVenue = new Map((dashboard.headcount.venues as { venueId: string }[]).map((venue) => [venue.venueId, venue]));
      expect(byVenue.get(venues.church)).toMatchObject({ attending: 2, declined: 3, pending: 0 });
      expect(byVenue.get(venues.hall)).toMatchObject({ attending: 3, declined: 2, pending: 0 });

      const catering = async (venueId: string) =>
        (await http().get(api(`/events/${venues.eventId}/catering-sheet?venueId=${venueId}`)).set('Authorization', authorization).expect(200)).body as Record<string, unknown>;
      expect(await catering(venues.church)).toMatchObject({ covers: 2, requirements: [] });
      expect(await catering(venues.hall)).toMatchObject({ covers: 3, requirements: [expect.objectContaining({ key: 'vegetarian', count: 1 })] });
    };

    /** One job per venue's arrangement; each seats only who said yes to that venue. */
    const seatEachVenue = async (authorization: string, venues: Venues) => {
      const { body: arrangements } = await http().get(api(`/events/${venues.eventId}/seating/arrangements`)).set('Authorization', authorization).expect(200);
      const seat = async (venueId: string) => {
        const arrangement = (arrangements as { id: string; venueId: string | null }[]).find((candidate) => candidate.venueId === venueId)!;
        const { body: job } = await http()
          .post(api(`/events/${venues.eventId}/seats/auto-assign?arrangementId=${arrangement.id}`))
          .set('Authorization', authorization)
          .send({ idempotencyKey: randomUUID() })
          .expect(201);
        expect(await app.get(SeatingRunner).runOne()).toBe(true);
        return (await http().get(api(`/events/${venues.eventId}/seating/jobs/${job.id as string}`)).set('Authorization', authorization).expect(200)).body as Record<string, unknown>;
      };
      expect(await seat(venues.church)).toMatchObject({ status: 'COMPLETED', result: { seated: 2, households: 1, unseated: [] } });
      expect(await seat(venues.hall)).toMatchObject({ status: 'COMPLETED', result: { seated: 3, households: 2, unseated: [] } });
      await http().post(api(`/events/${venues.eventId}/seating/publish`)).set('Authorization', authorization).expect(201);
    };

    /** Armen's link shows each person's own venues; the guest list export says the same. */
    const seatingPerPerson = async (authorization: string, venues: Venues) => {
      const { body: page } = await http().get(api(await linkFor(venues.eventId, 'invitation.send', 'armen@journey.test'))).expect(200);
      const venuesOf = (assignments: { venue: string }[]) => assignments.map((assignment) => assignment.venue).sort();
      expect(venuesOf(page.guest.seating.assignments as { venue: string }[])).toEqual(['Ararat Hall', 'Saint Gayane']);
      const household = new Map((page.guest.seating.household as { name: string; assignments: { venue: string }[] }[]).map((member) => [member.name, member.assignments]));
      expect(venuesOf(household.get('Lusine Petrosyan')!)).toEqual(['Saint Gayane']);
      expect(venuesOf(household.get('Narek Petrosyan')!)).toEqual(['Ararat Hall']);

      const guestList = await exportCsv(authorization, venues.eventId, 'GUEST_LIST');
      const seatingOf = new Map(guestList.map((row) => [row['First name'], row['Seating by venue']]));
      expect(seatingOf.get('Armen')).toMatch(/^Ararat Hall: Table \d; Saint Gayane: Pew 1$/);
      expect(seatingOf.get('Narek')).toMatch(/^Ararat Hall: Table \d$/);
      expect(seatingOf.get('Lusine')).toBe('Saint Gayane: Pew 1');
      expect(seatingOf.get('Mariam')).toMatch(/^Ararat Hall: Table \d$/);
      expect(seatingOf.get('Tigran')).toBe('');
    };

    /** The door and the thank-you, with arrivals from one household only. */
    const arriveAndThank = async (authorization: string, venues: Venues) => {
      const checkIn = async (firstName: string) =>
        (await http().post(api(`/events/${venues.eventId}/guests/${await guestId(venues.eventId, firstName)}/check-in`)).set('Authorization', authorization).expect(201)).body as Record<string, unknown>;
      // Seated at two venues, so the door screen lists both rather than one table.
      const armen = await checkIn('Armen');
      expect(armen).toMatchObject({ wasExpected: true, table: null });
      expect(armen.seating).toHaveLength(2);
      expect(await checkIn('Narek')).toMatchObject({ wasExpected: true, table: expect.stringMatching(/^Table \d$/) });

      await http().patch(api(`/events/${venues.eventId}`)).set('Authorization', authorization)
        .send({ startsAt: new Date(Date.now() - DAY_MS).toISOString() })
        .expect(200);
      const { body: thanks } = await http().post(api(`/invitations/${venues.slug}/thank-you`)).set('Authorization', authorization).send({}).expect(201);
      expect(thanks).toMatchObject({ basis: 'ARRIVED', queued: 1, recipients: [expect.objectContaining({ toAddress: 'armen@journey.test' })] });
    };

    it('seats and thanks each venue from the answers given for it', async () => {
      const authorization = await registerHost();
      const venues = await setUpTwoVenues(authorization);
      await publishAndSendTo(authorization, venues);
      await answerPerVenue(venues);
      // Per-venue answers have their own confirmation copy.
      expect(await prisma.message.count({ where: { eventId: venues.eventId, templateKey: 'rsvp.confirmation.venues' } })).toBe(3);
      await expectVenueHeadcounts(authorization, venues);
      await seatEachVenue(authorization, venues);
      await seatingPerPerson(authorization, venues);
      await arriveAndThank(authorization, venues);
    }, 120_000);
  });
});

describe('Journey 01: shutdown (e2e)', () => {
  afterAll(() => disconnectTestDatabase());

  it('closes the pooled SMTP connections when the application shuts down', async () => {
    const close = jest.spyOn(SmtpTransport.prototype, 'close');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(testPrisma())
      .compile();
    const app = moduleRef.createNestApplication();
    await app.init();
    const email = app.get<Map<MessageChannel, MessageTransport>>(MESSAGE_TRANSPORTS).get(MessageChannel.EMAIL);
    expect(email).toBeInstanceOf(SmtpTransport);

    await app.close();
    const callsAtShutdown = close.mock.calls.length;
    // So a failing run does not also leave the pool holding Jest open.
    if (callsAtShutdown === 0) (email as SmtpTransport).close();
    close.mockRestore();
    expect(callsAtShutdown).toBe(1);
  });
});
