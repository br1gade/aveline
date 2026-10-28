import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { ticketEvent, ticketServices } from '../fixtures/tickets.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';
import { randomUUID } from 'node:crypto';

describe('Named ticket checkout and host reconciliation (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const http = () => request(app.getHttpServer() as Server);
  beforeAll(async () => {
    prisma = testPrisma();
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(() => resetTestDatabase());
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });

  const fixture = async () => {
    const event = await ticketEvent(prisma);
    const dto = { buyerName: 'Buyer', buyerEmail: 'buyer@test.local', idempotencyKey: randomUUID(),
      items: [{ ticketTypeId: event.ticketTypeId, quantity: 1 }], attendees: [{ ticketTypeId: event.ticketTypeId, firstName: 'Anna', email: 'anna@test.local' }] };
    return { ...event, dto };
  };
  const buy = (event: Awaited<ReturnType<typeof fixture>>, body: object) => http().post(`/api/v1/public/events/${event.slug}/orders`).send(body);

  it.each([
    { label: 'missing roster', change: { attendees: undefined } },
    { label: 'empty roster', change: { attendees: [] } },
    { label: 'blank attendee name', change: { attendees: [{ firstName: '   ', ticketTypeId: 'replaced' }] } },
    { label: 'invalid attendee email', change: { attendees: [{ firstName: 'Anna', ticketTypeId: 'replaced', email: 'invalid' }] } },
  ])('rejects $label with a field error and no order', async ({ change }) => {
    const event = await fixture();
    const { body } = await buy(event, { ...event.dto, ...change }).expect(400);
    expect(JSON.stringify(body.message)).toContain('attendees');
    expect(await prisma.ticketOrder.count()).toBe(0);
  });

  it('returns attendee-to-ticket mapping and never reveals a guest capability', async () => {
    const event = await fixture();
    const { body } = await buy(event, event.dto).expect(201);
    expect(body).toMatchObject({ attendees: [{ firstName: 'Anna' }], tickets: [{ holderName: 'Anna', attendeeId: expect.any(String) }] });
    const guest = await prisma.guest.findFirstOrThrow({ where: { eventId: event.eventId, email: 'anna@test.local' } });
    expect(JSON.stringify(body)).not.toContain(guest.token);
    await buy(event, { ...event.dto, attendees: [{ ...event.dto.attendees[0], firstName: 'Davit' }] }).expect(409);
  });

  it('hides attendee contacts and ticket codes from viewers and refuses their writes', async () => {
    const event = await fixture();
    const { ticketing } = ticketServices(prisma);
    const order = await ticketing.createOrder(event.slug, event.dto);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.orderId } });
    const viewer = await authenticateAs(app, prisma, { eventId: event.eventId, role: 'VIEWER' });
    const url = `/api/v1/events/${event.eventId}`;
    const { body } = await http().get(`${url}/ticket-orders/${order.orderId}`).set('Authorization', viewer.authorization).expect(200);
    expect(body.attendees[0]).toMatchObject({ firstName: 'Anna' });
    expect(body.attendees[0]).not.toHaveProperty('email');
    expect(body.tickets[0]).not.toHaveProperty('code');
    await http().post(`${url}/tickets/${ticket.id}/link-guest`).set('Authorization', viewer.authorization).send({ guestId: ticket.guestId, expectedGuestId: ticket.guestId, keepExistingAnswers: true }).expect(403);
    const coordinator = await authenticateAs(app, prisma, { eventId: event.eventId, role: 'COORDINATOR' });
    const full = await http().get(`${url}/ticket-orders/${order.orderId}`).set('Authorization', coordinator.authorization).expect(200);
    expect(full.body.attendees[0].email).toBe('anna@test.local');
  });

  it('requires a reviewed link precondition and scopes reconciliation to the authorized event', async () => {
    const event = await fixture();
    const { ticketing } = ticketServices(prisma);
    const order = await ticketing.createOrder(event.slug, event.dto);
    const ticket = await prisma.ticket.findFirstOrThrow({ where: { orderId: order.orderId } });
    const invited = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    const host = await authenticateAs(app, prisma, { eventId: event.eventId, role: 'COORDINATOR' });
    const url = `/api/v1/events/${event.eventId}/tickets/${ticket.id}/link-guest`;
    await http().post(url).set('Authorization', host.authorization).send({ guestId: invited.id, expectedGuestId: ticket.guestId }).expect(400);
    await http().post(url).set('Authorization', host.authorization).send({ guestId: invited.id, expectedGuestId: ticket.guestId, keepExistingAnswers: true }).expect(201);
    const elsewhere = await ticketEvent(prisma);
    const otherHost = await authenticateAs(app, prisma, { eventId: elsewhere.eventId, role: 'COORDINATOR' });
    await http().get(`/api/v1/events/${elsewhere.eventId}/ticket-orders/${order.orderId}`).set('Authorization', otherHost.authorization).expect(404);
    await http().get(`/api/v1/events/${event.eventId}/ticket-orders/${order.orderId}`).set('Authorization', otherHost.authorization).expect(403);
  });
});
