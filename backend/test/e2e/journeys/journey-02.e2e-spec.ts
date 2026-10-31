import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BlockType, EventType, MessageChannel, PaymentProvider, PrismaClient } from '@prisma/client';
import request from 'supertest';
import sharp from 'sharp';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { STORAGE_ADAPTER } from '../../../src/infra/storage/storage-port';
import { FilesystemStorageAdapter } from '../../../src/infra/storage/adapters/filesystem.adapter';
import { ImageVariantsService } from '../../../src/modules/media/image-variants.service';
import { PaymentGatewayRegistry } from '../../../src/modules/payments/payment-gateway.registry';
import { FakeGateway } from '../../../src/modules/payments/providers/fake.gateway';
import { TicketingService } from '../../../src/modules/ticketing/ticketing.service';
import { TicketAcknowledgementInviter } from '../../../src/modules/guest-contributions/ticket-acknowledgement-inviter';
import { MESSAGE_COPY } from '../../../src/seed/message-copy';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * Journey 2: a ticketed public event, paid for with real money semantics.
 *
 * Every earlier HTTP chain sold free tickets, because paid checkout is
 * refused in the pilot. Here PILOT_MODE is off and the FAKE gateway stands in
 * for the bank, so the whole chain runs over HTTP: setup, listing with images,
 * a stranger's discounted order with named attendees and per-venue choices,
 * the bank round trip, the ticket email, the acknowledgement gate at the
 * door, and cancellation with its refund. Only the workers — image variants,
 * the acknowledgement-link sweep and the money sweep's settlement half — are
 * invoked in-process, as the scheduler would.
 */
describe('Journey 2: ticketed public event, from setup to refund (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let mediaRoot: string;
  const previousPilotMode = process.env.PILOT_MODE;

  const http = () => request(app.getHttpServer() as Server);
  const APP_URL = process.env.PUBLIC_APP_URL ?? 'http://localhost:5173';

  beforeAll(async () => {
    process.env.PILOT_MODE = 'false';
    prisma = testPrisma();
    mediaRoot = await mkdtemp(join(tmpdir(), 'aveline-journey-02-'));
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(STORAGE_ADAPTER)
      .useValue(new FilesystemStorageAdapter(mediaRoot, '/files'))
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    // Platform catalogue, not tenant data: the template an event is built
    // from and the copy the outbox renders. Seeded, as production seeds them.
    await prisma.designTemplate.create({
      data: { key: 'journey-02', name: 'Journey', allowedFonts: ['Inter'], supportedBlocks: [BlockType.HERO, BlockType.RSVP] },
    });
    const keys = ['ticket.issued', 'ticket.cancelled', 'ticket.acknowledgement'];
    for (const copy of MESSAGE_COPY.filter((item) => keys.includes(item.key) && item.channel === MessageChannel.EMAIL)) {
      await prisma.messageTemplate.create({ data: { ...copy, organizationId: null } });
    }
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
    await rm(mediaRoot, { recursive: true, force: true });
    if (previousPilotMode === undefined) delete process.env.PILOT_MODE;
    else process.env.PILOT_MODE = previousPilotMode;
  });

  const as = (authorization: string) => ({
    get: (path: string) => http().get(`/api/v1${path}`).set('Authorization', authorization),
    post: (path: string, body: object = {}) => http().post(`/api/v1${path}`).set('Authorization', authorization).send(body),
    put: (path: string, body: object) => http().put(`/api/v1${path}`).set('Authorization', authorization).send(body),
    patch: (path: string, body: object) => http().patch(`/api/v1${path}`).set('Authorization', authorization).send(body),
  });

  // A year ahead of whenever the suite runs, so the event never slips into the past.
  const startsAt = `${new Date().getUTCFullYear() + 1}-10-01T18:00:00.000Z`;

  const fakeBank = () => app.get(PaymentGatewayRegistry).get(PaymentProvider.FAKE) as FakeGateway;

  /** The stored outbox message for a template — what the stub SMTP cannot show. */
  const outbox = (templateKey: string, toAddress: string) =>
    prisma.message.findMany({ where: { templateKey, toAddress }, select: { subject: true, body: true, eventId: true, guestId: true } });

  const image = (width: number, height: number) =>
    sharp({ create: { width, height, channels: 3, background: '#7a8b74' } }).jpeg().toBuffer();

  /**
   * An organizer builds a public, paid, two-venue event from nothing over
   * HTTP: event, venues, published invitation, per-venue attendance, a
   * required acknowledgement, a priced ticket type, a listing with hero and
   * share images, and a promo code. Returns what each later step needs.
   */
  const ticketedEvent = async () => {
    const { authorization } = await authenticateAs(app, prisma);
    const host = as(authorization);
    await host.post('/organizations', { name: 'Yerevan Jazz' }).expect(201);
    const { body: event } = await host
      .post('/events', { type: EventType.OTHER, title: 'Autumn Jazz Night', templateKey: 'journey-02', startsAt,
        timezone: 'Asia/Yerevan', locales: ['en', 'hy'], defaultLocale: 'en' })
      .expect(201);
    const base = `/events/${event.id as string}`;
    const venues: { id: string; name: string }[] = [];
    for (const [role, name] of [['CEREMONY', 'Cathedral'], ['RECEPTION', 'Jazz Hall']]) {
      venues.push((await host.post(`${base}/venues`, { role, name, address: `${name}, Yerevan`, capacity: 100 }).expect(201)).body as { id: string; name: string });
    }
    await host.post(`/invitations/${event.invitation.slug as string}/publish`).expect(201);

    const { body: preview } = await host.post(`${base}/attendance-policy/preview`, { mode: 'PER_VENUE' }).expect(201);
    await host.post(`${base}/attendance-policy`, { ...(preview.request as object), transitionId: randomUUID() }).expect(201);
    const { body: statement } = await host
      .post(`/invitations/${event.invitation.slug as string}/questions`, { type: 'SIGNATURE', required: true, prompt: { en: 'I accept the venue rules' } })
      .expect(201);

    await host.patch(`${base}/settings`, { visibility: 'PUBLIC' }).expect(200);
    const { body: type } = await host
      .post(`${base}/ticket-types`, { name: { en: 'General', hy: 'Ընդհանուր' }, priceMinor: '10000', quantityTotal: 10, maxPerOrder: 4 })
      .expect(201);
    expect(type).toMatchObject({ priceMinor: '10000', sold: 0, available: 10 });

    const upload = async (kind: string, width: number) =>
      (await http().post(`/api/v1${base}/media`).set('Authorization', authorization).field('kind', kind)
        .attach('file', await image(width, Math.round(width / 1.5)), { filename: `${kind}.jpg`, contentType: 'image/jpeg' })
        .expect(201)).body as { id: string };
    const hero = await upload('PHOTO', 1200);
    const share = await upload('COVER', 1200);
    await app.get(ImageVariantsService).processPending();

    const { body: listing } = await host
      .put(`${base}/listing`, { headline: { en: 'Autumn Jazz Night', hy: 'Աշնանային ջազ' }, ogTitle: { en: 'Jazz in Yerevan' },
        categories: ['concert'], heroAssetId: hero.id, ogImageId: share.id })
      .expect(200);
    await host.post(`${base}/listing/publish`).expect(201);

    const { body: promo } = await host
      .post('/promo-codes', { code: 'autumn25', kind: 'PERCENT', value: '25', eventId: event.id, maxRedemptions: 5 })
      .expect(201);
    expect(promo).toMatchObject({ code: 'AUTUMN25', redemptions: 0, remaining: 5 });

    return { host, eventId: event.id as string, base, venues, statementVersionId: statement.statementVersionId as string,
      typeId: type.id as string, slug: listing.slug as string, heroId: hero.id, shareId: share.id, promoId: promo.id as string };
  };
  type TicketedEvent = Awaited<ReturnType<typeof ticketedEvent>>;

  /**
   * A stranger finds the event in browse, reads its checkout form, previews
   * the promo code and places an order for two named attendees, each with
   * their own venue choices. Payment starts; nothing is issued yet.
   */
  const strangerOrders = async (sale: TicketedEvent, buyerEmail: string) => {
    const { body: browse } = await http().get('/api/v1/public/events').query({ category: 'concert', locale: 'en' }).expect(200);
    const card = (browse.items as { slug: string; heroImage: { id: string } | null }[]).find((item) => item.slug === sale.slug);
    expect(card?.heroImage).toMatchObject({ id: sale.heroId });

    const { body: detail } = await http().get(`/api/v1/public/events/${sale.slug}`).query({ locale: 'en' }).expect(200);
    expect(detail.metadata).toMatchObject({ imageAssetId: sale.shareId, image: { id: sale.shareId } });
    expect(detail.ticketTypes).toEqual([expect.objectContaining({ id: sale.typeId, available: 10 })]);
    expect(detail.checkout).toMatchObject({ attendanceMode: 'PER_VENUE' });
    const [cathedral, hall] = detail.checkout.venues as { id: string }[];

    const basket = [{ ticketTypeId: sale.typeId, quantity: 2 }];
    const { body: quote } = await http().post(`/api/v1/public/events/${sale.slug}/promo-check`).send({ code: 'autumn25', items: basket }).expect(201);
    expect(quote).toMatchObject({ isApplicable: true, subtotalMinor: '20000', discountMinor: '5000', totalMinor: '15000' });

    const { body: order } = await http()
      .post(`/api/v1/public/events/${sale.slug}/orders`)
      .send({
        items: basket, buyerName: 'Ani Grigoryan', buyerEmail, locale: 'en', promoCode: 'autumn25', provider: 'FAKE',
        returnUrl: `${APP_URL}/tickets/return`, idempotencyKey: randomUUID(), attendanceRevision: detail.checkout.attendanceRevision,
        attendees: [
          { ticketTypeId: sale.typeId, firstName: 'Anna', email: `anna-${buyerEmail}`,
            venueAttendance: [{ venueId: cathedral.id, status: 'ATTENDING' }, { venueId: hall.id, status: 'ATTENDING' }] },
          { ticketTypeId: sale.typeId, firstName: 'Davit', venueAttendance: [{ venueId: cathedral.id, status: 'DECLINED' }, { venueId: hall.id, status: 'ATTENDING' }] },
        ],
      })
      .expect(201);
    expect(order).toMatchObject({ status: 'RESERVED', totalMinor: '15000', discountMinor: '5000', currency: 'AMD' });
    expect((order.attendees as { firstName: string }[]).map((person) => person.firstName)).toEqual(['Anna', 'Davit']);
    expect(order.payment.orderNumber).toEqual(expect.any(String));
    const redirect = new URL(order.payment.redirectUrl as string);
    expect(redirect.origin + redirect.pathname).toBe(`${APP_URL}/tickets/return`);
    return { ...order, providerRef: redirect.searchParams.get('fakePayment')!, cathedral, hall } as {
      orderId: string; accessToken: string; payment: { orderNumber: string }; providerRef: string; cathedral: { id: string }; hall: { id: string };
    };
  };
  type PlacedOrder = Awaited<ReturnType<typeof strangerOrders>>;

  /** The two tickets the buyer holds, read through their own access token. */
  const buyerSees = async (order: PlacedOrder) =>
    (await http().get(`/api/v1/ticket-orders/${order.accessToken}`).expect(200)).body as {
      status: string; tickets: { code: string; holderName: string; status: string }[];
    };

  /**
   * The acknowledgement sweep emails Anna (who gave an address) her personal
   * link, and she signs the venue rules through it. Returns her guest id.
   */
  const annaAcknowledges = async (sale: TicketedEvent, email: string) => {
    await app.get(TicketAcknowledgementInviter).sendMissing();
    const [invite] = await outbox('ticket.acknowledgement', email);
    const link = /\/invitations\/[^/\s]+\/g\/[^/\s]+/.exec(invite.body)![0];
    await http().post(`/api/v1${link}/acknowledgements`)
      .send({ statementVersionId: sale.statementVersionId, subjectGuestIds: [invite.guestId], method: 'TYPED', signerName: 'Anna', isAcknowledged: true, locale: 'en' })
      .expect(201);
    return invite.guestId!;
  };

  it('sells a discounted paid order through the bank, emails the tickets, and admits only acknowledged attendees, after which it cannot be cancelled', async () => {
    const sale = await ticketedEvent();
    const order = await strangerOrders(sale, 'ani@test.local');

    // The buyer is back from the bank but has not paid: the redirect proves nothing.
    const { body: early } = await http().post(`/api/v1/ticket-orders/${order.accessToken}/confirm`).expect(201);
    expect(early).toMatchObject({ status: 'RESERVED', payment: { status: 'PENDING' } });
    expect((await buyerSees(order)).tickets).toEqual([]);
    expect((await sale.host.get(`${sale.base}/ticket-types`).expect(200)).body[0]).toMatchObject({ sold: 0, held: 2, available: 8 });

    // The payer completes the bank's form; the server asks the bank itself.
    fakeBank().simulateSuccess(order.providerRef);
    const { body: payment } = await http().post(`/api/v1/payments/${order.payment.orderNumber}/confirm`).expect(201);
    expect(payment).toMatchObject({ status: 'CAPTURED', amountMinor: '15000' });
    const { body: paid } = await http().post(`/api/v1/ticket-orders/${order.accessToken}/confirm`).expect(201);
    expect(paid.status).toBe('PAID');
    expect((paid.tickets as { holderName: string }[]).map((ticket) => ticket.holderName).sort()).toEqual(['Anna', 'Davit']);
    expect((paid.tickets as { status: string }[]).every((ticket) => ticket.status === 'VALID')).toBe(true);
    await http().post(`/api/v1/ticket-orders/${order.accessToken}/confirm`).expect(201);

    // One ticket email, carrying the buyer's own way back to the order.
    const issued = await outbox('ticket.issued', 'ani@test.local');
    expect(issued).toEqual([expect.objectContaining({ subject: 'Your tickets', eventId: sale.eventId })]);
    expect(issued[0].body).toContain('Ani Grigoryan');
    expect(issued[0].body).toContain(`${APP_URL}/tickets/${order.accessToken}`);

    // The host sees the sale, the promo use and the attendees as guests with their own venue answers.
    expect((await sale.host.get(`${sale.base}/ticket-types`).expect(200)).body[0]).toMatchObject({ sold: 2, held: 0, available: 8 });
    expect((await sale.host.get('/promo-codes').expect(200)).body[0]).toMatchObject({ code: 'AUTUMN25', redemptions: 1, remaining: 4 });
    const { body: orders } = await sale.host.get(`${sale.base}/ticket-orders`).expect(200);
    expect(orders).toEqual([expect.objectContaining({ buyerName: 'Ani Grigoryan', tickets: 2, buyerEmail: 'ani@test.local' })]);
    const { body: households } = await sale.host.get(`${sale.base}/guests`).expect(200);
    const people = (households as { guests: { firstName: string }[] }[]).flatMap((household) => household.guests);
    expect(people.map((person) => person.firstName).sort()).toEqual(['Anna', 'Davit']);
    const { body: roster } = await sale.host.get(`${sale.base}/ticket-orders/${order.orderId}`).expect(200);
    const davit = (roster.attendees as { firstName: string; venueAttendance: { venueId: string; status: string }[] }[]).find((person) => person.firstName === 'Davit')!;
    expect(davit.venueAttendance).toEqual(expect.arrayContaining([
      expect.objectContaining({ venueId: order.cathedral.id, status: 'DECLINED' }), expect.objectContaining({ venueId: order.hall.id, status: 'ATTENDING' })]));

    // At the door: nobody is admitted before acknowledging the venue rules.
    const tickets = (await buyerSees(order)).tickets;
    const annaCode = tickets.find((ticket) => ticket.holderName === 'Anna')!.code;
    const davitCode = tickets.find((ticket) => ticket.holderName === 'Davit')!.code;
    const { body: refused } = await sale.host.post(`${sale.base}/tickets/${annaCode}/admit`).expect(400);
    expect(refused.message).toMatch(/^acknowledgements: .*must acknowledge/);

    const annaGuestId = await annaAcknowledges(sale, 'anna-ani@test.local');

    const { body: admitted } = await sale.host.post(`${sale.base}/tickets/${annaCode}/admit`).expect(201);
    expect(admitted).toMatchObject({ code: annaCode, holderName: 'Anna', guestId: annaGuestId });
    const { body: rescanned } = await sale.host.post(`${sale.base}/tickets/${annaCode}/admit`).expect(400);
    expect(rescanned.message).toBe('Ticket already used');
    // Anna's signature covers Anna only: Davit, who never signed, is still turned away.
    const { body: davitRefused } = await sale.host.post(`${sale.base}/tickets/${davitCode}/admit`).expect(400);
    expect(davitRefused.message).toMatch(/^acknowledgements: .*must acknowledge/);
    const statuses = Object.fromEntries((await buyerSees(order)).tickets.map((ticket) => [ticket.code, ticket.status]));
    expect(statuses).toEqual({ [annaCode]: 'USED', [davitCode]: 'VALID' });

    // Attendance has happened, so cancelling is a dispute, not a refund.
    const { body: disputed } = await sale.host.post(`${sale.base}/ticket-orders/${order.orderId}/cancel`).expect(409);
    expect(disputed.message).toMatch(/already admitted/);
    expect((await buyerSees(order)).status).toBe('PAID');
    expect((await http().get(`/api/v1/payments/${order.payment.orderNumber}`).expect(200)).body.status).toBe('CAPTURED');
    expect(await outbox('ticket.cancelled', 'ani@test.local')).toEqual([]);
  });

  it('settles a buyer who never came back through reconciliation, then cancels with a full refund that voids the tickets, returns the seats and the promo use, and tells the buyer', async () => {
    const sale = await ticketedEvent();
    const order = await strangerOrders(sale, 'lost@test.local');

    // The buyer paid and closed the tab. Operations reconcile (docs/API.md: ops
    // only, so platform staff); the money sweep's second half settles.
    fakeBank().simulateSuccess(order.providerRef);
    const ops = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: ops.userId }, data: { platformRole: 'ADMIN' } });
    const { body: sweep } = await as(ops.authorization).post('/payments/reconcile').expect(201);
    expect(sweep).toMatchObject({ checked: 1, changed: 1 });
    expect(await app.get(TicketingService).settleCapturedPayments()).toEqual({ settled: 1 });
    const settled = await buyerSees(order);
    expect(settled.status).toBe('PAID');
    expect(settled.tickets).toHaveLength(2);
    expect(await outbox('ticket.issued', 'lost@test.local')).toHaveLength(1);
    await annaAcknowledges(sale, 'anna-lost@test.local');

    // The host cancels: one action refunds the money and voids every ticket.
    const { body: cancelled } = await sale.host.post(`${sale.base}/ticket-orders/${order.orderId}/cancel`).expect(201);
    expect(cancelled).toMatchObject({ orderId: order.orderId, status: 'REFUNDED', refundedMinor: '15000', currency: 'AMD' });
    expect((cancelled.tickets as { status: string }[]).map((ticket) => ticket.status)).toEqual(['VOID', 'VOID']);
    const { body: again } = await sale.host.post(`${sale.base}/ticket-orders/${order.orderId}/cancel`).expect(201);
    expect(again).toMatchObject({ status: 'REFUNDED', refundedMinor: '15000' });

    const { body: payment } = await http().get(`/api/v1/payments/${order.payment.orderNumber}`).expect(200);
    expect(payment).toMatchObject({ status: 'REFUNDED', refundedMinor: '15000' });
    expect(await prisma.refund.count({ where: { payment: { orderNumber: order.payment.orderNumber } } })).toBe(1);

    // What the buyer, the host and the door each see afterwards.
    const after = await buyerSees(order);
    expect(after.status).toBe('REFUNDED');
    expect(after.tickets.every((ticket) => ticket.status === 'VOID')).toBe(true);
    expect((await sale.host.get(`${sale.base}/ticket-types`).expect(200)).body[0]).toMatchObject({ sold: 0, held: 0, available: 10 });
    expect((await sale.host.get('/promo-codes').expect(200)).body[0]).toMatchObject({ redemptions: 0, remaining: 5 });
    // Anna had acknowledged, so the door refuses her for the cancellation alone.
    const annaCode = after.tickets.find((ticket) => ticket.holderName === 'Anna')!.code;
    const { body: refusedAtDoor } = await sale.host.post(`${sale.base}/tickets/${annaCode}/admit`).expect(400);
    expect(refusedAtDoor.message).toBe('Ticket order is cancelled or cancellation is in progress');

    const notice = await outbox('ticket.cancelled', 'lost@test.local');
    expect(notice).toEqual([expect.objectContaining({ subject: 'Your order has been cancelled' })]);
    expect(notice[0].body).toContain('15000 AMD');
    expect(notice[0].body).toContain('Autumn Jazz Night');
  });
});
