import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BlockType, EventType, MessageChannel, PaymentProvider, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { MessageTransport } from '../../../src/modules/communications/channels/message-channel';
import { SmtpTransport } from '../../../src/modules/communications/channels/smtp.transport';
import { MESSAGE_TRANSPORTS } from '../../../src/modules/communications/communications.module';
import { PaymentGatewayRegistry } from '../../../src/modules/payments/payment-gateway.registry';
import { FakeGateway } from '../../../src/modules/payments/providers/fake.gateway';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { MESSAGE_COPY } from '../../../src/seed/message-copy';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

interface Attendance { mode: string; revision: number; status: string; needsReconfirmation: boolean; venues: { venueId: string; status: string }[] }
interface HostGuest { id: string; firstName: string; attendance: Attendance }
interface BuyerView { status: string; tickets: { code: string; holderName: string; status: string }[] }

/**
 * Journey 3, ticketed: per-venue choices made at checkout meet a later
 * change of attendance mode.
 *
 * A public, paid, two-venue concert answers per venue. One buyer pays and is
 * admitted; a second reserves under the per-venue form but pays only after
 * the host switches to one answer for the whole event. Payment goes through
 * the FAKE bank with PILOT_MODE off. The host's counts, the door, the
 * buyers' tickets, a stale checkout form and the host's phone-in
 * reconfirmation are all driven over HTTP.
 */
describe('Journey 3 (tickets): checkout venue choices across an attendance mode change (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const previousPilotMode = process.env.PILOT_MODE;

  const http = () => request(app.getHttpServer() as Server);
  const APP_URL = process.env.PUBLIC_APP_URL ?? 'http://localhost:5173';

  beforeAll(async () => {
    process.env.PILOT_MODE = 'false';
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    await prisma.designTemplate.create({
      data: { key: 'journey-03-tickets', name: 'Journey', allowedFonts: ['Inter'], supportedBlocks: [BlockType.HERO, BlockType.RSVP] },
    });
    await prisma.messageTemplate.createMany({ data: MESSAGE_COPY.map((template) => ({ ...template, organizationId: null })) });
  });

  afterAll(async () => {
    const email = app.get<Map<MessageChannel, MessageTransport>>(MESSAGE_TRANSPORTS).get(MessageChannel.EMAIL);
    if (email instanceof SmtpTransport) email.close();
    await app.close();
    await disconnectTestDatabase();
    if (previousPilotMode === undefined) delete process.env.PILOT_MODE;
    else process.env.PILOT_MODE = previousPilotMode;
  });

  const as = (authorization: string) => ({
    get: (path: string) => http().get(`/api/v1${path}`).set('Authorization', authorization),
    post: (path: string, body: object = {}) => http().post(`/api/v1${path}`).set('Authorization', authorization).send(body),
    put: (path: string, body: object) => http().put(`/api/v1${path}`).set('Authorization', authorization).send(body),
    patch: (path: string, body: object) => http().patch(`/api/v1${path}`).set('Authorization', authorization).send(body),
  });
  const fakeBank = () => app.get(PaymentGatewayRegistry).get(PaymentProvider.FAKE) as FakeGateway;

  /** A public, paid concert in two venues, answered per venue, listed for sale. */
  const concert = async () => {
    const { authorization } = await authenticateAs(app, prisma);
    const host = as(authorization);
    await host.post('/organizations', { name: 'Yerevan Jazz' }).expect(201);
    const { body: event } = await host.post('/events', {
      type: EventType.OTHER, title: 'Two Halls Night', templateKey: 'journey-03-tickets', startsAt: '2027-10-01T18:00:00.000Z',
      timezone: 'Asia/Yerevan', locales: ['en'], defaultLocale: 'en',
    }).expect(201);
    const base = `/events/${event.id as string}`;
    const venue = async (role: string, name: string) =>
      (await host.post(`${base}/venues`, { role, name, address: `${name}, Yerevan`, capacity: 100 }).expect(201)).body.id as string;
    const cathedral = await venue('CEREMONY', 'Cathedral');
    const hall = await venue('RECEPTION', 'Jazz Hall');
    await host.post(`/invitations/${event.invitation.slug as string}/publish`).expect(201);
    const { body: preview } = await host.post(`${base}/attendance-policy/preview`, { mode: 'PER_VENUE' }).expect(201);
    await host.post(`${base}/attendance-policy`, { ...(preview.request as object), transitionId: randomUUID() }).expect(201);
    await host.patch(`${base}/settings`, { visibility: 'PUBLIC' }).expect(200);
    const { body: type } = await host.post(`${base}/ticket-types`, { name: { en: 'General' }, priceMinor: '10000', quantityTotal: 10, maxPerOrder: 4 }).expect(201);
    const { body: listing } = await host.put(`${base}/listing`, { headline: { en: 'Two Halls Night' }, categories: ['concert'] }).expect(200);
    await host.post(`${base}/listing/publish`).expect(201);
    return { host, base, cathedral, hall, typeId: type.id as string, slug: listing.slug as string };
  };
  type Concert = Awaited<ReturnType<typeof concert>>;

  const checkoutForm = async (sale: Concert) =>
    ((await http().get(`/api/v1/public/events/${sale.slug}`).query({ locale: 'en' }).expect(200)).body.checkout) as {
      attendanceMode: string; attendanceRevision: number; venues: { id: string }[];
    };

  /** An order body for named attendees, each as `{ firstName, venueAttendance? }`. */
  const orderBody = (sale: Concert, buyerEmail: string, revision: number, attendees: object[]) => ({
    items: [{ ticketTypeId: sale.typeId, quantity: attendees.length }], buyerName: buyerEmail.split('@')[0], buyerEmail, locale: 'en',
    provider: 'FAKE', returnUrl: `${APP_URL}/tickets/return`, idempotencyKey: randomUUID(), attendanceRevision: revision,
    attendees: attendees.map((attendee) => ({ ticketTypeId: sale.typeId, ...attendee })),
  });
  const placeOrder = async (sale: Concert, body: object) => {
    const { body: order } = await http().post(`/api/v1/public/events/${sale.slug}/orders`).send(body).expect(201);
    expect(order.status).toBe('RESERVED');
    return { orderId: order.orderId as string, accessToken: order.accessToken as string, orderNumber: order.payment.orderNumber as string,
      providerRef: new URL(order.payment.redirectUrl as string).searchParams.get('fakePayment')! };
  };
  type Order = Awaited<ReturnType<typeof placeOrder>>;
  /** The payer completes the bank's form; the server asks the bank, then the buyer's return settles. */
  const pay = async (order: Order) => {
    fakeBank().simulateSuccess(order.providerRef);
    expect((await http().post(`/api/v1/payments/${order.orderNumber}/confirm`).expect(201)).body.status).toBe('CAPTURED');
    expect((await http().post(`/api/v1/ticket-orders/${order.accessToken}/confirm`).expect(201)).body.status).toBe('PAID');
  };
  const buyerSees = async (order: Order) => (await http().get(`/api/v1/ticket-orders/${order.accessToken}`).expect(200)).body as BuyerView;
  const guests = async (sale: Concert) => {
    const { body: households } = await sale.host.get(`${sale.base}/guests`).expect(200);
    const people = (households as { guests: { id: string; firstName: string }[] }[]).flatMap((household) => household.guests);
    const detailed = new Map<string, HostGuest>();
    for (const person of people) detailed.set(person.firstName, (await sale.host.get(`${sale.base}/guests/${person.id}`).expect(200)).body as HostGuest);
    return detailed;
  };
  const headcount = async (sale: Concert) => (await sale.host.get(`${sale.base}/headcount`).expect(200)).body as {
    attending: number; pending: number; venues: { venueId: string; attending: number; declined: number; pending: number }[];
  };
  const venueCounts = (counts: Awaited<ReturnType<typeof headcount>>, venueId: string) => counts.venues.find((venue) => venue.venueId === venueId);

  /** Step 1: a paid per-venue order becomes guests with their own venue answers, and one is admitted. */
  const firstBuyerPaysAndIsAdmitted = async (sale: Concert) => {
    const form = await checkoutForm(sale);
    expect(form).toMatchObject({ attendanceMode: 'PER_VENUE', attendanceRevision: 2 });
    const order = await placeOrder(sale, orderBody(sale, 'ani@journey03.test', form.attendanceRevision, [
      { firstName: 'Anna', venueAttendance: [{ venueId: sale.cathedral, status: 'ATTENDING' }, { venueId: sale.hall, status: 'ATTENDING' }] },
      { firstName: 'Davit', venueAttendance: [{ venueId: sale.cathedral, status: 'DECLINED' }, { venueId: sale.hall, status: 'ATTENDING' }] },
    ]));
    await pay(order);

    const counts = await headcount(sale);
    expect(counts).toMatchObject({ attending: 2, pending: 0 });
    expect(venueCounts(counts, sale.cathedral)).toMatchObject({ attending: 1, declined: 1, pending: 0 });
    expect(venueCounts(counts, sale.hall)).toMatchObject({ attending: 2, declined: 0, pending: 0 });
    expect((await sale.host.get(`${sale.base}/catering-sheet?venueId=${sale.cathedral}`).expect(200)).body).toMatchObject({ covers: 1 });

    const anna = (await buyerSees(order)).tickets.find((ticket) => ticket.holderName === 'Anna')!;
    await sale.host.post(`${sale.base}/tickets/${anna.code}/admit`).expect(201);
    return order;
  };

  /** Step 3: what the change leaves standing — tickets, admission and the checkout roster — and what it resets. */
  const changeKeepsTicketsAndAdmission = async (sale: Concert, first: Order) => {
    const after = await buyerSees(first);
    expect(after.status).toBe('PAID');
    expect(after.tickets.map((ticket) => `${ticket.holderName}:${ticket.status}`).sort()).toEqual(['Anna:USED', 'Davit:VALID']);
    expect((await sale.host.get(`${sale.base}/arrivals`).expect(200)).body).toMatchObject({ arrived: 1 });
    const people = await guests(sale);
    for (const name of ['Anna', 'Davit']) {
      expect(people.get(name)!.attendance).toMatchObject({ mode: 'EVENT_WIDE', revision: 3, status: 'PENDING', needsReconfirmation: true });
    }
    expect(await headcount(sale)).toMatchObject({ attending: 0, pending: 2 });
    // The checkout's own record of the choices is untouched.
    const { body: roster } = await sale.host.get(`${sale.base}/ticket-orders/${first.orderId}`).expect(200);
    const davit = (roster.attendees as { firstName: string; venueAttendance: { venueId: string; status: string }[] }[]).find((person) => person.firstName === 'Davit')!;
    expect(davit.venueAttendance).toEqual(expect.arrayContaining([
      expect.objectContaining({ venueId: sale.cathedral, status: 'DECLINED' }), expect.objectContaining({ venueId: sale.hall, status: 'ATTENDING' })]));
  };

  /** Step 4: a reservation from the old form settles, but buying never invents an answer under the new policy. */
  const lateSettlementMustReconfirm = async (sale: Concert, late: Order) => {
    await pay(late);
    expect((await buyerSees(late)).tickets).toEqual([expect.objectContaining({ holderName: 'Karine', status: 'VALID' })]);
    const karine = (await guests(sale)).get('Karine')!;
    expect(karine.attendance).toMatchObject({ mode: 'EVENT_WIDE', revision: 3, status: 'PENDING' });
    const { body: roster } = await sale.host.get(`${sale.base}/ticket-orders/${late.orderId}`).expect(200);
    expect(roster.attendees).toEqual([expect.objectContaining({ firstName: 'Karine', venueAttendance: [expect.objectContaining({ venueId: sale.hall, status: 'ATTENDING' })] })]);
    expect(await headcount(sale)).toMatchObject({ attending: 0, pending: 3 });
    return karine.id;
  };

  /** Step 5: a form still showing the old policy is refused before any seat is held. */
  const staleCheckoutIsRefused = async (sale: Concert) => {
    const form = await checkoutForm(sale);
    expect(form).toMatchObject({ attendanceMode: 'EVENT_WIDE', attendanceRevision: 3 });
    const stale = orderBody(sale, 'late@journey03.test', 2, [{ firstName: 'Gor', venueAttendance: [{ venueId: sale.hall, status: 'ATTENDING' }] }]);
    const { body: refused } = await http().post(`/api/v1/public/events/${sale.slug}/orders`).send(stale).expect(409);
    expect(refused.message).toMatch(/^attendanceRevision:/);
    expect((await sale.host.get(`${sale.base}/ticket-types`).expect(200)).body[0]).toMatchObject({ sold: 3, held: 0, available: 7 });
    // The current form: an omitted status means attending, at every venue.
    await pay(await placeOrder(sale, orderBody(sale, 'gor@journey03.test', form.attendanceRevision, [{ firstName: 'Gor' }])));
    const counts = await headcount(sale);
    expect(counts).toMatchObject({ attending: 1, pending: 3 });
    expect(counts.venues.map((venue) => venue.attending)).toEqual([1, 1]);
  };

  /** Step 6: the host records phone-in reconfirmations under the current revision only. */
  const hostRecordsReconfirmation = async (sale: Concert, karineId: string) => {
    const rsvpPath = `${sale.base}/guests/${karineId}/rsvp`;
    const { body: stale } = await sale.host.patch(rsvpPath, { attendanceRevision: 2, venueAttendance: [{ venueId: sale.hall, status: 'ATTENDING' }] }).expect(409);
    expect(stale.message).toMatch(/^attendanceRevision:/);
    const { body: refusedLeftUnchanged } = await sale.host.get(`${sale.base}/guests/${karineId}`).expect(200);
    expect((refusedLeftUnchanged as HostGuest).attendance).toMatchObject({ revision: 3, status: 'PENDING', needsReconfirmation: true });
    await sale.host.patch(rsvpPath, { attendanceRevision: 3, status: 'ATTENDING' }).expect(200);
    expect((await guests(sale)).get('Karine')!.attendance).toMatchObject({ status: 'ATTENDING', needsReconfirmation: false });
    const counts = await headcount(sale);
    expect(counts).toMatchObject({ attending: 2, pending: 2 });
    expect(venueCounts(counts, sale.cathedral)).toMatchObject({ attending: 2, pending: 2 });
  };

  it('keeps paid tickets and admission across a switch to event-wide answers, settles an old-form order without inventing answers, and takes only current-revision answers afterwards', async () => {
    const sale = await concert();
    const first = await firstBuyerPaysAndIsAdmitted(sale);
    const late = await placeOrder(sale, orderBody(sale, 'karine@journey03.test', 2, [{ firstName: 'Karine', venueAttendance: [{ venueId: sale.hall, status: 'ATTENDING' }] }]));

    // Step 2: the host switches to one answer for the whole event. Karine is not a guest yet.
    const { body: preview } = await sale.host.post(`${sale.base}/attendance-policy/preview`, { mode: 'EVENT_WIDE' }).expect(201);
    expect(preview).toMatchObject({ expectedRevision: 2, affected: { guests: 2, responses: 2 } });
    expect((await sale.host.post(`${sale.base}/attendance-policy`, { ...(preview.request as object), transitionId: randomUUID() }).expect(201)).body)
      .toMatchObject({ mode: 'EVENT_WIDE', revision: 3 });

    await changeKeepsTicketsAndAdmission(sale, first);
    const karineId = await lateSettlementMustReconfirm(sale, late);
    await staleCheckoutIsRefused(sale);
    await hostRecordsReconfirmation(sale, karineId);
  }, 120_000);
});
