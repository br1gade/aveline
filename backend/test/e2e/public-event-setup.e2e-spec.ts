import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventType, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * Setting up a public event from nothing, entirely over HTTP.
 *
 * Every other ticketing test seeds its ticket types and listing directly in
 * the database — which is exactly how it went unnoticed that nothing could
 * create them. This suite allows itself no such shortcut: if a step here
 * needs a database write, the API is missing an endpoint.
 */
describe('Public event setup (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const http = () => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  /** An organizer with an event, created through the API like a real one. */
  const organizer = async () => {
    const { authorization } = await authenticateAs(app, prisma);
    await http()
      .post('/api/v1/organizations')
      .set('Authorization', authorization)
      .send({ name: 'Yerevan Jazz' })
      .expect(201);
    const { body } = await http()
      .post('/api/v1/events')
      .set('Authorization', authorization)
      .send({ type: EventType.OTHER, title: 'Autumn Jazz Night', startsAt: '2027-10-01T18:00:00.000Z' })
      .expect(201);
    return { authorization, eventId: body.id as string };
  };

  const at = (path: string, authorization: string) => ({
    get: () => http().get(path).set('Authorization', authorization),
    post: (body: object = {}) => http().post(path).set('Authorization', authorization).send(body),
    put: (body: object) => http().put(path).set('Authorization', authorization).send(body),
    patch: (body: object) => http().patch(path).set('Authorization', authorization).send(body),
    delete: () => http().delete(path).set('Authorization', authorization),
  });

  it('goes from nothing to a listed event a stranger can buy from', async () => {
    const { authorization, eventId } = await organizer();
    const base = `/api/v1/events/${eventId}`;

    await at(`${base}/settings`, authorization).patch({ visibility: 'PUBLIC' }).expect(200);

    const { body: type } = await at(`${base}/ticket-types`, authorization)
      .post({ name: { hy: 'Ընդհանուր', en: 'General' }, priceMinor: '0', quantityTotal: 50 })
      .expect(201);
    expect(type).toMatchObject({ available: 50, sold: 0, priceMinor: '0' });

    const { body: listing } = await at(`${base}/listing`, authorization)
      .put({ headline: { en: 'Autumn Jazz Night' }, categories: ['concert'] })
      .expect(200);
    expect(listing.slug).toMatch(/^autumn-jazz-night-[0-9a-f]{6}$/);

    await at(`${base}/listing/publish`, authorization).post().expect(201);

    // A stranger finds it and buys a free ticket.
    const { body: browse } = await http().get('/api/v1/public/events').expect(200);
    const listed = (browse as { items: { slug: string }[] }).items.map((item) => item.slug);
    expect(listed).toContain(listing.slug);

    const { body: order } = await http()
      .post(`/api/v1/public/events/${listing.slug}/orders`)
      .send({
        items: [{ ticketTypeId: type.id, quantity: 2 }],
        buyerName: 'Ani',
        buyerEmail: 'ani@test.local',
        idempotencyKey: 'stranger-1',
      })
      .expect(201);
    expect(order.status).toBe('PAID');
    expect(order.tickets).toHaveLength(2);
  });

  describe('ticket types', () => {
    it('rejects a type with no name in any language', async () => {
      const { authorization, eventId } = await organizer();

      await at(`/api/v1/events/${eventId}/ticket-types`, authorization)
        .post({ name: {}, priceMinor: '1000', quantityTotal: 10 })
        .expect(400);
    });

    it.each([
      { label: 'a negative price', body: { priceMinor: '-1' } },
      { label: 'a decimal price', body: { priceMinor: '10.5' } },
      { label: 'zero capacity', body: { quantityTotal: 0 } },
    ])('rejects $label', async ({ body }) => {
      const { authorization, eventId } = await organizer();

      await at(`/api/v1/events/${eventId}/ticket-types`, authorization)
        .post({ name: { en: 'GA' }, priceMinor: '1000', quantityTotal: 10, ...body })
        .expect(400);
    });

    /**
     * Decided: price may change for future buyers. Orders already placed
     * keep what they paid, because each order line captured its unit price.
     */
    it('lets the price change after sales, without touching placed orders', async () => {
      const { authorization, eventId } = await organizer();
      const base = `/api/v1/events/${eventId}`;
      const { body: type } = await at(`${base}/ticket-types`, authorization)
        .post({ name: { en: 'GA' }, priceMinor: '0', quantityTotal: 10 })
        .expect(201);
      await prisma.ticketType.update({ where: { id: type.id }, data: { quantitySold: 3 } });

      const { body: updated } = await at(`${base}/ticket-types/${type.id}`, authorization)
        .patch({ priceMinor: '25000' })
        .expect(200);

      expect(updated.priceMinor).toBe('25000');
    });

    it('refuses to shrink capacity below what is sold, naming the floor', async () => {
      const { authorization, eventId } = await organizer();
      const base = `/api/v1/events/${eventId}`;
      const { body: type } = await at(`${base}/ticket-types`, authorization)
        .post({ name: { en: 'GA' }, priceMinor: '0', quantityTotal: 10 })
        .expect(201);
      await prisma.ticketType.update({ where: { id: type.id }, data: { quantitySold: 6 } });

      const { body } = await at(`${base}/ticket-types/${type.id}`, authorization)
        .patch({ quantityTotal: 4 })
        .expect(400);

      expect(JSON.stringify(body.message)).toContain('6');
    });

    it('deletes an unsold type but only deactivates a sold one', async () => {
      const { authorization, eventId } = await organizer();
      const base = `/api/v1/events/${eventId}`;
      const { body: unsold } = await at(`${base}/ticket-types`, authorization)
        .post({ name: { en: 'Unsold' }, priceMinor: '0', quantityTotal: 10 })
        .expect(201);
      const { body: sold } = await at(`${base}/ticket-types`, authorization)
        .post({ name: { en: 'Sold' }, priceMinor: '0', quantityTotal: 10 })
        .expect(201);
      await prisma.ticketType.update({ where: { id: sold.id }, data: { quantitySold: 1 } });

      await at(`${base}/ticket-types/${unsold.id}`, authorization).delete().expect(200);
      const { body } = await at(`${base}/ticket-types/${sold.id}`, authorization).delete().expect(409);

      expect(body.message).toContain('isActive');
    });
  });

  describe('the listing', () => {
    // A private event must never appear in public browse.
    it('refuses to publish a listing for a private event', async () => {
      const { authorization, eventId } = await organizer();
      const base = `/api/v1/events/${eventId}`;
      await at(`${base}/listing`, authorization).put({ headline: { en: 'Jazz' } }).expect(200);

      const { body } = await at(`${base}/listing/publish`, authorization).post().expect(400);

      expect(JSON.stringify(body.message)).toContain('private');
    });

    it('refuses to publish a listing with no headline', async () => {
      const { authorization, eventId } = await organizer();
      const base = `/api/v1/events/${eventId}`;
      await at(`${base}/settings`, authorization).patch({ visibility: 'PUBLIC' }).expect(200);
      await at(`${base}/listing`, authorization).put({ categories: ['concert'] }).expect(200);

      await at(`${base}/listing/publish`, authorization).post().expect(400);
    });

    /**
     * Making an event private takes its listing down in the same act, so
     * there is no moment where the event is private and still announced.
     */
    it('takes the listing down when the event is made private', async () => {
      const { authorization, eventId } = await organizer();
      const base = `/api/v1/events/${eventId}`;
      await at(`${base}/settings`, authorization).patch({ visibility: 'PUBLIC' }).expect(200);
      const { body: listing } = await at(`${base}/listing`, authorization)
        .put({ headline: { en: 'Jazz' } })
        .expect(200);
      await at(`${base}/listing/publish`, authorization).post().expect(201);

      await at(`${base}/settings`, authorization).patch({ visibility: 'PRIVATE' }).expect(200);

      const { body: browse } = await http().get('/api/v1/public/events').expect(200);
      const listed = (browse as { items: { slug: string }[] }).items.map((item) => item.slug);
      expect(listed).not.toContain(listing.slug);
    });

    it('refuses a slug someone else already has', async () => {
      const first = await organizer();
      const second = await organizer();
      await at(`/api/v1/events/${first.eventId}/listing`, first.authorization)
        .put({ slug: 'jazz-night', headline: { en: 'Jazz' } })
        .expect(200);

      await at(`/api/v1/events/${second.eventId}/listing`, second.authorization)
        .put({ slug: 'jazz-night', headline: { en: 'Other Jazz' } })
        .expect(409);
    });
  });

  describe('orders', () => {
    it('lists them for the host, and cancels a free one', async () => {
      const { authorization, eventId } = await organizer();
      const base = `/api/v1/events/${eventId}`;
      await at(`${base}/settings`, authorization).patch({ visibility: 'PUBLIC' }).expect(200);
      const { body: type } = await at(`${base}/ticket-types`, authorization)
        .post({ name: { en: 'GA' }, priceMinor: '0', quantityTotal: 10 })
        .expect(201);
      const { body: listing } = await at(`${base}/listing`, authorization)
        .put({ headline: { en: 'Jazz' } })
        .expect(200);
      await at(`${base}/listing/publish`, authorization).post().expect(201);
      const { body: order } = await http()
        .post(`/api/v1/public/events/${listing.slug}/orders`)
        .send({
          items: [{ ticketTypeId: type.id, quantity: 2 }],
          buyerName: 'Ani',
          buyerEmail: 'ani@test.local',
          idempotencyKey: 'order-list-1',
        })
        .expect(201);

      const { body: orders } = await at(`${base}/ticket-orders`, authorization).get().expect(200);
      expect(orders).toHaveLength(1);
      expect(orders[0]).toMatchObject({ buyerName: 'Ani', tickets: 2 });

      const { body: cancelled } = await at(`${base}/ticket-orders/${order.orderId}/cancel`, authorization)
        .post()
        .expect(201);
      expect(cancelled.status).toBe('CANCELLED');

      const { body: types } = await at(`${base}/ticket-types`, authorization).get().expect(200);
      expect(types[0]).toMatchObject({ sold: 0, available: 10 });
    });

    // Money leaves the business, so it needs the money permission.
    it('refuses cancellation by a coordinator', async () => {
      const { eventId } = await organizer();
      const { authorization } = await authenticateAs(app, prisma, { eventId, role: 'COORDINATOR' });

      await at(`/api/v1/events/${eventId}/ticket-orders/whatever/cancel`, authorization)
        .post()
        .expect(403);
    });
  });

  /**
   * Staff only, deliberately: the route looks a payment up by order number
   * alone, so an organization owner allowed to call it could reach another
   * organization's payment. Ticket refunds go through cancellation, which is
   * scoped to the event.
   */
  describe('the refund endpoint', () => {
    const staff = async () => {
      const { authorization, userId } = await authenticateAs(app, prisma);
      await prisma.user.update({ where: { id: userId }, data: { platformRole: 'ADMIN' } });
      return { authorization };
    };

    it('refuses an organization owner', async () => {
      const { authorization } = await organizer();

      await http()
        .post('/api/v1/payments/any-order/refund')
        .set('Authorization', authorization)
        .send({ amountMinor: '100' })
        .expect(403);
    });

    // It used to call BigInt on an unvalidated body and answer a 500.
    it.each([
      { label: 'missing', body: {} },
      { label: 'not a number', body: { amountMinor: 'abc' } },
      { label: 'negative', body: { amountMinor: '-100' } },
      { label: 'zero', body: { amountMinor: '0' } },
    ])('rejects an amount that is $label with a 400, not a 500', async ({ body }) => {
      const { authorization } = await staff();

      await http()
        .post('/api/v1/payments/any-order/refund')
        .set('Authorization', authorization)
        .send(body)
        .expect(400);
    });
  });
});
