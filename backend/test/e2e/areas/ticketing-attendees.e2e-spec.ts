import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, EventType, PaymentProvider, PrismaClient, RsvpStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { TicketCancellationService } from '../../../src/modules/ticketing/ticket-cancellation.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { attendeeRoster, ticketEvent } from '../../fixtures/tickets.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * After the sale (docs/API.md §5 "Reviewing and reconciling attendees" and
 * "Cancelling an order"): registering a named person on a legacy ticket, a
 * cancelled ticket holder trying to come back through the RSVP form, and the
 * refusals of cancel itself.
 */
describe('Ticket attendees and cancellation (e2e coverage)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const previousPilotMode = process.env.PILOT_MODE;

  const http = () => request(app.getHttpServer() as Server);

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
  });

  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
    if (previousPilotMode === undefined) delete process.env.PILOT_MODE;
    else process.env.PILOT_MODE = previousPilotMode;
  });

  const buyFree = (slug: string, ticketTypeId: string) =>
    http()
      .post(`/api/v1/public/events/${slug}/orders`)
      .send({ items: [{ ticketTypeId, quantity: 1 }], attendees: attendeeRoster(ticketTypeId, 1), buyerName: 'Ani', buyerEmail: 'ani@test.local', idempotencyKey: randomUUID() })
      .expect(201);

  describe('registering an attendee on a legacy ticket', () => {
    /** A paid order from before named checkout: one ticket, no attendee, no guest. */
    const legacyTicket = async () => {
      const event = await ticketEvent(prisma);
      const order = await prisma.ticketOrder.create({ data: { eventId: event.eventId, buyerName: 'Buyer', buyerEmail: 'buyer@test.local', totalMinor: 0n,
        currency: 'AMD', status: 'PAID', idempotencyKey: randomUUID(), accessToken: randomUUID() } });
      const ticket = await prisma.ticket.create({ data: { eventId: event.eventId, orderId: order.id, ticketTypeId: event.ticketTypeId, code: randomUUID(), holderName: 'Buyer' } });
      const coordinator = await authenticateAs(app, prisma, { eventId: event.eventId, role: EventRole.COORDINATOR });
      const register = (body: object, authorization = coordinator.authorization) =>
        http().post(`/api/v1/events/${event.eventId}/tickets/${ticket.id}/attendee`).set('Authorization', authorization).send(body);
      return { event, order, ticket, register };
    };

    it('creates the named guest on the existing ticket without issuing another code', async () => {
      const { event, order, ticket, register } = await legacyTicket();

      const { body } = await register({ attendee: { ticketTypeId: event.ticketTypeId, firstName: 'Actual' } }).expect(201);

      expect(body).toEqual({ ticketId: ticket.id, attendeeId: expect.any(String), guestId: expect.any(String) });
      const current = await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } });
      expect(current).toMatchObject({ code: ticket.code, guestId: body.guestId, attendeeId: body.attendeeId, holderName: 'Actual' });
      expect(await prisma.ticket.count({ where: { orderId: order.id } })).toBe(1);
    });

    it('refuses a ticket type other than the ticket’s own, naming the field', async () => {
      const { event, ticket, register } = await legacyTicket();
      const other = await prisma.ticketType.create({ data: { eventId: event.eventId, name: { en: 'VIP' }, priceMinor: 0n, quantityTotal: 5 } });

      const { body } = await register({ attendee: { ticketTypeId: other.id, firstName: 'Actual' } }).expect(400);

      expect(body.message).toMatch(/^attendee\.ticketTypeId must match this ticket/);
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).guestId).toBeNull();
      expect(await prisma.orderAttendee.count()).toBe(0);
    });

    it('refuses a household key, because registration creates one household', async () => {
      const { event, ticket, register } = await legacyTicket();

      const { body } = await register({ attendee: { ticketTypeId: event.ticketTypeId, firstName: 'Actual', householdKey: 'family' } }).expect(400);

      expect(body.message).toMatch(/one household/);
      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).guestId).toBeNull();
    });

    it('answers 409 for a ticket already registered, keeping the first person', async () => {
      const { event, ticket, register } = await legacyTicket();
      const { body: first } = await register({ attendee: { ticketTypeId: event.ticketTypeId, firstName: 'Actual' } }).expect(201);

      await register({ attendee: { ticketTypeId: event.ticketTypeId, firstName: 'Different' } }).expect(409);

      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).guestId).toBe(first.guestId);
    });

    it('rejects a missing attendee as a field error', async () => {
      const { register } = await legacyTicket();

      const { body } = await register({}).expect(400);

      expect(body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'attendee' })]));
    });

    it('refuses a viewer', async () => {
      const { event, ticket, register } = await legacyTicket();
      const viewer = await authenticateAs(app, prisma, { eventId: event.eventId, role: EventRole.VIEWER });

      await register({ attendee: { ticketTypeId: event.ticketTypeId, firstName: 'Actual' } }, viewer.authorization).expect(403);

      expect((await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } })).guestId).toBeNull();
    });
  });

  describe('a cancelled ticket holder answering the invitation', () => {
    const cancelledHolder = async () => {
      const event = await ticketEvent(prisma);
      const { body: order } = await buyFree(event.slug, event.ticketTypeId);
      await app.get(TicketCancellationService).cancel(event.eventId, order.orderId as string);
      const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.orderId as string }, include: { guest: true } });
      const rsvp = (status: RsvpStatus) =>
        http().post(`/api/v1/invitations/${event.invitationSlug}/g/${ticket.guest!.token}/rsvp`).send({ status });
      return { event, ticket, rsvp };
    };

    it('cannot reconfirm attendance on a void ticket', async () => {
      const { ticket, rsvp } = await cancelledHolder();

      const { body } = await rsvp(RsvpStatus.ATTENDING).expect(400);

      expect(body.message).toMatch(/attendance cannot be reconfirmed/);
      expect((await prisma.rsvp.findUniqueOrThrow({ where: { guestId: ticket.guestId! } })).status).toBe(RsvpStatus.DECLINED);
    });

    it('may still say they are not coming', async () => {
      const { ticket, rsvp } = await cancelledHolder();

      await rsvp(RsvpStatus.DECLINED).expect(201);

      expect((await prisma.rsvp.findUniqueOrThrow({ where: { guestId: ticket.guestId! } })).status).toBe(RsvpStatus.DECLINED);
    });
  });

  describe('what cancellation refuses', () => {
    /** An organization owner — who holds billing:write — with a public event selling at 10000. */
    const ownerSale = async () => {
      const { authorization } = await authenticateAs(app, prisma);
      const as = (method: 'get' | 'post' | 'patch' | 'put', path: string, body: object = {}) =>
        http()[method](`/api/v1${path}`).set('Authorization', authorization).send(body);
      await as('post', '/organizations', { name: 'Yerevan Jazz' }).expect(201);
      const { body: event } = await as('post', '/events', { type: EventType.OTHER, title: 'Jazz', startsAt: '2027-10-01T18:00:00.000Z' }).expect(201);
      const base = `/events/${event.id as string}`;
      await as('patch', `${base}/settings`, { visibility: 'PUBLIC' }).expect(200);
      const { body: type } = await as('post', `${base}/ticket-types`, { name: { en: 'GA' }, priceMinor: '10000', quantityTotal: 10 }).expect(201);
      const { body: listing } = await as('put', `${base}/listing`, { headline: { en: 'Jazz' } }).expect(200);
      await as('post', `${base}/listing/publish`).expect(201);
      const { body: order } = await http().post(`/api/v1/public/events/${listing.slug as string}/orders`)
        .send({ items: [{ ticketTypeId: type.id, quantity: 1 }], attendees: attendeeRoster(type.id as string, 1), buyerName: 'Ani', buyerEmail: 'ani@test.local',
          provider: PaymentProvider.FAKE, idempotencyKey: randomUUID() })
        .expect(201);
      return { as, base, order, typeId: type.id as string };
    };

    it('refuses an order that is reserved and not yet paid, touching neither seats nor payment', async () => {
      const { as, base, order, typeId } = await ownerSale();

      const { body } = await as('post', `${base}/ticket-orders/${order.orderId as string}/cancel`).expect(400);

      expect(body.message).toMatch(/reserved, not paid, so there is nothing to cancel/);
      expect(await prisma.ticketType.findUniqueOrThrow({ where: { id: typeId } })).toMatchObject({ quantityReserved: 1, quantitySold: 0 });
      expect(await prisma.payment.findUniqueOrThrow({ where: { orderNumber: order.payment.orderNumber as string } })).toMatchObject({ status: 'PENDING', refundedMinor: 0n });
    });

    it('does not find another event’s order under this event', async () => {
      const ours = await ownerSale();
      const theirs = await ownerSale();

      const { body } = await ours.as('post', `${ours.base}/ticket-orders/${theirs.order.orderId as string}/cancel`).expect(404);

      expect(body.message).toMatch(/No such order on this event/);
      expect((await prisma.ticketOrder.findUniqueOrThrow({ where: { id: theirs.order.orderId as string } })).status).toBe('RESERVED');
    });
  });
});
