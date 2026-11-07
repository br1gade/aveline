import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DiscountKind, EventRole, EventType, PaymentProvider, PlatformRole, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { appPage } from '../../../src/common/app-url';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { PaymentGatewayRegistry } from '../../../src/modules/payments/payment-gateway.registry';
import { TicketFulfilmentService } from '../../../src/modules/ticketing/ticket-fulfilment.service';
import { FakeGateway } from '../../../src/modules/payments/providers/fake.gateway';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { attendeeRoster } from '../../fixtures/tickets.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * The buyer's and the host's ticketing contract over HTTP (docs/API.md §5):
 * paying through the FAKE bank and confirming, what checkout refuses, what
 * the listing shows to strangers and crawlers, and who may set any of it up.
 * PILOT_MODE is off so a priced basket really starts a payment.
 */
describe('Ticketing contract (e2e coverage)', () => {
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

  const fakeBank = () => app.get(PaymentGatewayRegistry).get(PaymentProvider.FAKE) as FakeGateway;

  const as = (authorization: string) => ({
    get: (path: string) => http().get(`/api/v1${path}`).set('Authorization', authorization),
    post: (path: string, body: object = {}) => http().post(`/api/v1${path}`).set('Authorization', authorization).send(body),
    put: (path: string, body: object) => http().put(`/api/v1${path}`).set('Authorization', authorization).send(body),
    patch: (path: string, body: object) => http().patch(`/api/v1${path}`).set('Authorization', authorization).send(body),
    delete: (path: string) => http().delete(`/api/v1${path}`).set('Authorization', authorization),
  });

  interface SaleOptions {
    priceMinor?: string;
    quantityTotal?: number;
    visibility?: 'PUBLIC' | 'UNLISTED';
    listing?: Record<string, unknown>;
    locales?: string[];
    defaultLocale?: string;
  }

  /** An organizer, an event, one ticket type and a published listing — all over HTTP. */
  const sale = async (options: SaleOptions = {}) => {
    const { authorization } = await authenticateAs(app, prisma);
    const host = as(authorization);
    await host.post('/organizations', { name: 'Yerevan Jazz' }).expect(201);
    const { body: event } = await host
      .post('/events', { type: EventType.OTHER, title: 'Autumn Jazz Night', startsAt: '2027-10-01T18:00:00.000Z',
        ...(options.locales ? { locales: options.locales, defaultLocale: options.defaultLocale } : {}) })
      .expect(201);
    const base = `/events/${event.id as string}`;
    await host.patch(`${base}/settings`, { visibility: options.visibility ?? 'PUBLIC' }).expect(200);
    const { body: type } = await host
      .post(`${base}/ticket-types`, { name: { en: 'General' }, priceMinor: options.priceMinor ?? '10000', quantityTotal: options.quantityTotal ?? 10 })
      .expect(201);
    const { body: listing } = await host.put(`${base}/listing`, options.listing ?? { headline: { en: 'Jazz' } }).expect(200);
    await host.post(`${base}/listing/publish`).expect(201);
    return { authorization, host, eventId: event.id as string, base, slug: listing.slug as string, typeId: type.id as string };
  };

  type Sale = Awaited<ReturnType<typeof sale>>;

  const checkout = (slug: string, typeId: string, overrides: Record<string, unknown> = {}) => {
    const quantity = (overrides.quantity as number | undefined) ?? 1;
    const { quantity: _quantity, ...rest } = overrides;
    return http()
      .post(`/api/v1/public/events/${slug}/orders`)
      .send({
        items: [{ ticketTypeId: typeId, quantity }],
        attendees: attendeeRoster(typeId, quantity),
        buyerName: 'Ani',
        buyerEmail: 'ani@test.local',
        provider: PaymentProvider.FAKE,
        idempotencyKey: randomUUID(),
        ...rest,
      });
  };

  const inventory = async (typeId: string) => {
    const type = await prisma.ticketType.findUniqueOrThrow({ where: { id: typeId } });
    return { sold: type.quantitySold, held: type.quantityReserved };
  };

  const browseSlugs = async (query: Record<string, string> = {}) =>
    ((await http().get('/api/v1/public/events').query(query).expect(200)).body as { items: { slug: string }[] }).items.map((item) => item.slug);

  describe('venue ticket layout versions', () => {
    const layout = {
      key: 'concert', name: 'Concert', expectedVersion: 0, sections: [
        { key: 'balcony', name: 'Balcony', mode: 'NUMBERED', rows: [{ label: 'B', seats: ['12', '13'] }] },
        { key: 'floor', name: 'Standing floor', mode: 'UNNUMBERED', capacity: 250 },
      ],
    };

    it('shares an immutable version across shows and lets a later show adopt an update', async () => {
      const staff = await authenticateAs(app, prisma);
      await prisma.user.update({ where: { id: staff.userId }, data: { platformRole: PlatformRole.ADMIN } });
      const admin = as(staff.authorization);
      const profile = await prisma.venueProfile.create({ data: { name: 'Theatre', address: 'Main street' } });
      const publish = `/venue-profiles/${profile.id}/ticket-layouts`;
      const first = await sale();
      await first.host.post(publish, layout).expect(403);
      const { body: v1 } = await admin.post(publish, layout).expect(201);
      expect(v1).toMatchObject({ version: 1, sections: layout.sections });

      const attach = async (show: Sale, versionId: string) => {
        const { body: venue } = await show.host.post(`${show.base}/venues`, { profileId: profile.id, role: 'OTHER',
          name: 'Theatre', address: 'Main street' }).expect(201);
        const path = `${show.base}/venues/${venue.id as string}/ticket-layout`;
        await show.host.put(path, { versionId }).expect(200);
        return path;
      };
      const firstPath = await attach(first, v1.id as string);
      const second = await sale();
      const secondPath = await attach(second, v1.id as string);
      const update = { ...layout, expectedVersion: 1, name: 'Concert updated' };
      const updates = await Promise.all([admin.post(publish, update), admin.post(publish, update)]);
      expect(updates.map((response) => response.status).sort()).toEqual([201, 409]);
      const { id: v2Id } = updates.find((response) => response.status === 201)!.body as { id: string };
      expect((await second.host.get(secondPath + 's').expect(200)).body)
        .toEqual([{ id: v2Id, key: 'concert', name: 'Concert updated', version: 2 }]);
      expect((await second.host.get(`${secondPath}s/${v2Id}`).expect(200)).body)
        .toMatchObject({ id: v2Id, sections: layout.sections });
      await second.host.put(secondPath, { versionId: v2Id }).expect(200);
      expect((await first.host.get(firstPath).expect(200)).body).toMatchObject({ id: v1.id, name: 'Concert', version: 1 });
      expect((await second.host.get(secondPath).expect(200)).body).toMatchObject({ id: v2Id, name: 'Concert updated', version: 2 });
      await first.host.get(secondPath).expect(403);
      const otherProfile = await prisma.venueProfile.create({ data: { name: 'Other theatre', address: 'Other street' } });
      const { body: other } = await admin.post(`/venue-profiles/${otherProfile.id}/ticket-layouts`, layout).expect(201);
      await second.host.put(secondPath, { versionId: other.id }).expect(404);
      await prisma.venueProfile.update({ where: { id: profile.id }, data: { isActive: false } });
      await second.host.put(secondPath, { versionId: v1.id }).expect(404);
      expect((await second.host.get(secondPath).expect(200)).body).toMatchObject({ id: v2Id });

    });

    const sellLayout = async (options: SaleOptions = {}) => {
      const staff = await authenticateAs(app, prisma);
      await prisma.user.update({ where: { id: staff.userId }, data: { platformRole: PlatformRole.ADMIN } });
      const profile = await prisma.venueProfile.create({ data: { name: 'Theatre', address: 'Main street' } });
      const { body: version } = await as(staff.authorization).post(`/venue-profiles/${profile.id}/ticket-layouts`, {
        ...layout, sections: [layout.sections[0], { ...layout.sections[1], capacity: 1 }],
      }).expect(201);
      const show = await sale(options);
      const { body: venue } = await show.host.post(`${show.base}/venues`, { profileId: profile.id, role: 'OTHER',
        name: 'Theatre', address: 'Main street' }).expect(201);
      const { body: alternative } = await show.host.post(`${show.base}/ticket-types`, {
        name: { en: 'Alternative floor price' }, priceMinor: options.priceMinor ?? '10000', quantityTotal: 10,
      }).expect(201);
      await show.host.put(`${show.base}/venues/${venue.id}/ticket-layout`, { versionId: version.id }).expect(200);
      await show.host.post(`${show.base}/ticket-inventory`, {
        venueId: venue.id, layoutVersionId: version.id, offers: [
          { sectionKey: 'balcony', ticketTypeId: show.typeId },
          { sectionKey: 'floor', ticketTypeId: show.typeId },
          { sectionKey: 'floor', ticketTypeId: alternative.id },
        ],
      }).expect(201);
      const path = `/api/v1/public/events/${show.slug}/ticket-inventory`;
      const { body: availability } = await http().get(`${path}/balcony`).expect(200);
      expect(availability.seats).toHaveLength(2);
      return { ...show, path, seats: availability.seats as { id: string }[], profileId: profile.id, layoutVersionId: version.id as string,
        alternativeId: alternative.id as string };
    };

    it('sells each numbered seat only once under competing checkouts', async () => {
      const show = await sellLayout({ priceMinor: '0' });
      const seatId = show.seats[0].id;
      const placeOrder = () => checkout(show.slug, show.typeId, {
        layoutVersionId: show.layoutVersionId, selections: [{ sectionKey: 'balcony', seatId }],
      });
      const orders = await Promise.all([placeOrder(), placeOrder()]);
      expect(orders.map((order) => order.status).sort()).toEqual([201, 409]);
      expect(orders.find((order) => order.status === 409)?.body).toMatchObject({
        code: 'TICKET_SELECTION_UNAVAILABLE', selection: { sectionKey: 'balcony', seatId },
      });
      const { body: order } = orders.find((response) => response.status === 201)!;
      expect(order.attendees[0].selection).toMatchObject({ sectionKey: 'balcony', seatId, row: 'B', seat: '12' });
      expect((await http().get(`${show.path}/balcony`).expect(200)).body.seats).toEqual([expect.objectContaining(show.seats[1])]);
      await show.host.post(`${show.base}/tickets/${order.tickets[0].code}/admit`).expect(201);
    });

    it('keeps the same layout independent between shows', async () => {
      const first = await sellLayout({ priceMinor: '0' });
      const second = await sale({ priceMinor: '0' });
      const { body: venue } = await second.host.post(`${second.base}/venues`, { profileId: first.profileId, role: 'OTHER',
        name: 'Theatre', address: 'Main street' }).expect(201);
      await second.host.post(`${second.base}/ticket-inventory`, {
        venueId: venue.id, layoutVersionId: first.layoutVersionId, offers: [{ sectionKey: 'balcony', ticketTypeId: second.typeId }],
        blockedSeats: [{ sectionKey: 'balcony', row: 'B', seat: '13' }],
      }).expect(201);
      await checkout(first.slug, first.typeId, {
        layoutVersionId: first.layoutVersionId, selections: [{ sectionKey: 'balcony', seatId: first.seats[0].id }],
      }).expect(201);
      const { body } = await http().get(`/api/v1/public/events/${second.slug}/ticket-inventory/balcony`).expect(200);
      expect(body.seats).toEqual([{ id: expect.any(String), row: 'B', label: '12' }]);
      expect(body.seats[0].id).not.toBe(first.seats[0].id);
      await checkout(second.slug, second.typeId, {
        layoutVersionId: 'stale-layout', selections: [{ sectionKey: 'balcony', seatId: body.seats[0].id }],
      }).expect(409);
      await checkout(second.slug, second.typeId, {
        layoutVersionId: first.layoutVersionId, selections: [{ sectionKey: 'balcony', seatId: body.seats[0].id }],
      }).expect(201);
    });

    it('shares a zone across prices and rolls back a mixed basket when a seat is gone', async () => {
      const show = await sellLayout({ priceMinor: '0' });
      const seatId = show.seats[0].id;
      const balcony = { sectionKey: 'balcony', seatId };
      const floor = { sectionKey: 'floor' };
      const placeOrder = (typeId: string, selections: object[]) => checkout(show.slug, typeId, {
        layoutVersionId: show.layoutVersionId, quantity: selections.length, selections,
      });
      await checkout(show.slug, show.typeId).expect(409);
      await placeOrder(show.typeId, [balcony]).expect(201);
      await placeOrder(show.typeId, [floor, balcony]).expect(409);
      expect((await http().get(`${show.path}/floor`).expect(200)).body.available).toBe(1);
      const orders = await Promise.all([placeOrder(show.typeId, [floor]), placeOrder(show.alternativeId, [floor])]);
      expect(orders.map((order) => order.status).sort()).toEqual([201, 409]);
      const { body: order } = orders.find((response) => response.status === 201)!;
      await show.host.post(`${show.base}/ticket-orders/${order.orderId}/cancel`).expect(201);
      await placeOrder(show.typeId, [floor]).expect(201);
    });

    it('releases expired mixed selections and refunds a late capture when the exact seat is gone', async () => {
      const show = await sellLayout();
      const seatId = show.seats[0].id;
      const selections = [{ sectionKey: 'balcony', seatId }, { sectionKey: 'floor' }];
      const { body: original } = await checkout(show.slug, show.typeId, {
        layoutVersionId: show.layoutVersionId, quantity: 2, selections,
      }).expect(201);
      await app.get(TicketFulfilmentService).expire(original.orderId as string);
      await checkout(show.slug, show.typeId, { layoutVersionId: show.layoutVersionId, selections: [selections[0]] }).expect(201);
      fakeBank().simulateSuccess(`fake_${original.payment.orderNumber as string}`);
      const { body: late } = await http().post(`/api/v1/ticket-orders/${original.accessToken}/confirm`).expect(201);
      expect(late).toMatchObject({ status: 'REFUNDED', tickets: [] });
      expect((await http().get(`${show.path}/floor`).expect(200)).body.available).toBe(1);
    });

    it('imports and publishes a 75,000-seat stadium layout', async () => {
      const staff = await authenticateAs(app, prisma);
      await prisma.user.update({ where: { id: staff.userId }, data: { platformRole: PlatformRole.ADMIN } });
      const profile = await prisma.venueProfile.create({ data: { name: 'Stadium', address: 'Main street' } });
      const path = `/api/v1/venue-profiles/${profile.id}/ticket-layouts/import`;
      const records = Array.from({ length: 75_000 }, (_, position) => {
        const section = Math.floor(position / 1_000);
        const row = Math.floor((position % 1_000) / 50);
        return `section-${section},Section ${section},NUMBERED,${row + 1},${(position % 50) + 1},`;
      });
      const csv = ['section_key,section_name,mode,row,seat,capacity', ...records].join('\n');
      const { body: layout } = await http().post(path).set('Authorization', staff.authorization)
        .field('key', 'stadium').field('name', 'Stadium concert').field('expectedVersion', '0')
        .attach('file', Buffer.from(csv), 'seats.csv').expect(201);
      const show = await sale({ priceMinor: '0' });
      const { body: venue } = await show.host.post(`${show.base}/venues`, { profileId: profile.id, role: 'OTHER',
        name: 'Stadium', address: 'Main street' }).expect(201);
      await show.host.post(`${show.base}/ticket-inventory`, {
        venueId: venue.id, layoutVersionId: layout.id, offers: Array.from({ length: 75 }, (_, section) => ({
          sectionKey: `section-${section}`, ticketTypeId: show.typeId,
        })),
      }).expect(201);
      const { body: section } = await http().get(`/api/v1/public/events/${show.slug}/ticket-inventory/section-74`).expect(200);
      expect(section.available).toBe(1000);
      expect(section.seats).toHaveLength(1000);
    });

    it('rejects duplicate seat labels and numbered sections with a zone capacity', async () => {
      const staff = await authenticateAs(app, prisma);
      await prisma.user.update({ where: { id: staff.userId }, data: { platformRole: PlatformRole.ADMIN } });
      const profile = await prisma.venueProfile.create({ data: { name: 'Theatre', address: 'Main street' } });
      const publish = `/venue-profiles/${profile.id}/ticket-layouts`;
      const bad = [
        { ...layout.sections[0], rows: [{ label: 'B', seats: ['12', '12'] }] },
        { ...layout.sections[0], capacity: 250 },
      ];
      for (const section of bad) {
        const { body } = await as(staff.authorization).post(publish, { ...layout, sections: [section] }).expect(400);
        expect(body.message).toMatch(/sections/);
      }
    });
  });

  describe('buyer ticket limits', () => {
    it('caps concurrent orders across ticket types and email casing and releases capacity on cancellation', async () => {
      const shop = await sale({ priceMinor: '0' });
      const { body: other } = await shop.host.post(`${shop.base}/ticket-types`, {
        name: { en: 'Other section' }, priceMinor: '0', quantityTotal: 10,
      }).expect(201);
      await shop.host.put(`${shop.base}/listing`, { buyerTicketLimit: 0 }).expect(400);
      await shop.host.put(`${shop.base}/listing`, { buyerTicketLimit: 2 }).expect(200);
      expect((await http().get(`/api/v1/public/events/${shop.slug}`).expect(200)).body.checkout)
        .toMatchObject({ buyerTicketLimit: 2 });

      const [first, second] = await Promise.all([
        checkout(shop.slug, shop.typeId, { quantity: 2, buyerEmail: 'Ani@test.local' }),
        checkout(shop.slug, other.id as string, { quantity: 2, buyerEmail: 'ani@test.local' }),
      ]);
      expect([first.status, second.status].sort()).toEqual([201, 409]);
      const accepted = first.status === 201 ? first : second;
      const refused = first.status === 409 ? first : second;
      expect(refused.body).toMatchObject({ code: 'TICKET_BUYER_LIMIT_REACHED' });
      expect(await prisma.ticketOrder.count()).toBe(1);

      await shop.host.post(`${shop.base}/ticket-orders/${accepted.body.orderId as string}/cancel`).expect(201);
      await checkout(shop.slug, shop.typeId, { quantity: 2 }).expect(201);
      await shop.host.put(`${shop.base}/listing`, { buyerTicketLimit: null }).expect(200);
      await checkout(shop.slug, shop.typeId, { quantity: 2 }).expect(201);
    });

    it('counts pending holds and refunds a late capture when the buyer has since used their allowance', async () => {
      const shop = await sale();
      await shop.host.put(`${shop.base}/listing`, { buyerTicketLimit: 1 }).expect(200);
      const { body: earlier } = await checkout(shop.slug, shop.typeId).expect(201);
      await checkout(shop.slug, shop.typeId).expect(409);

      await app.get(TicketFulfilmentService).expire(earlier.orderId as string);
      const { body: current } = await checkout(shop.slug, shop.typeId).expect(201);
      fakeBank().simulateSuccess(`fake_${earlier.payment.orderNumber as string}`);
      const { body } = await http().post(`/api/v1/ticket-orders/${earlier.accessToken as string}/confirm`).expect(201);
      expect(body.status).toBe('REFUNDED');
      expect(await prisma.ticket.count({ where: { orderId: earlier.orderId as string } })).toBe(0);
      expect(await prisma.ticketOrder.findUniqueOrThrow({ where: { id: current.orderId as string } }))
        .toMatchObject({ status: 'RESERVED' });
      expect(await inventory(shop.typeId)).toEqual({ sold: 0, held: 1 });
    });
  });

  describe('paying for tickets', () => {
    /** A RESERVED paid order and the bank reference the FAKE gateway knows it by. */
    const reserved = async (quantity = 2) => {
      const shop = await sale();
      const { body: order } = await checkout(shop.slug, shop.typeId, { quantity }).expect(201);
      return { shop, order, providerRef: `fake_${order.payment.orderNumber as string}` };
    };

    it('holds the seats and returns a bank link and a deadline, but issues no ticket yet', async () => {
      const { shop, order } = await reserved(2);

      expect(order).toMatchObject({ status: 'RESERVED', totalMinor: '20000', currency: 'AMD', accessToken: expect.stringMatching(/^[0-9a-f]{32}$/) });
      expect(new Date(order.reservesUntil as string).getTime()).toBeGreaterThan(Date.now());
      expect(order.payment.redirectUrl).toContain('fakePayment=');
      expect(await prisma.ticket.count()).toBe(0);
      expect(await inventory(shop.typeId)).toEqual({ sold: 0, held: 2 });
    });

    it('confirms nothing while the bank has not captured the money', async () => {
      const { shop, order } = await reserved(2);

      const { body } = await http().post(`/api/v1/ticket-orders/${order.accessToken as string}/confirm`).expect(201);

      expect(body.status).toBe('RESERVED');
      expect(await prisma.ticket.count()).toBe(0);
      expect(await inventory(shop.typeId)).toEqual({ sold: 0, held: 2 });
    });

    it('issues the tickets once the bank captured, and the buyer reads the same tickets back', async () => {
      const { shop, order, providerRef } = await reserved(2);
      fakeBank().simulateSuccess(providerRef);

      const { body: paid } = await http().post(`/api/v1/ticket-orders/${order.accessToken as string}/confirm`).expect(201);
      const { body: read } = await http().get(`/api/v1/ticket-orders/${order.accessToken as string}`).expect(200);

      const issued = paid.tickets as { code: string; status: string }[];
      const readBack = read.tickets as { code: string }[];
      expect(paid.status).toBe('PAID');
      expect(issued).toHaveLength(2);
      expect(issued.every((ticket) => ticket.status === 'VALID')).toBe(true);
      expect(readBack.map((ticket) => ticket.code).sort()).toEqual(issued.map((ticket) => ticket.code).sort());
      expect(await inventory(shop.typeId)).toEqual({ sold: 2, held: 0 });
    });

    it('returns localized buyer order context on read and every successful confirmation', async () => {
      const shop = await sale({ locales: ['en', 'ru'], defaultLocale: 'en' });
      await prisma.event.update({ where: { id: shop.eventId }, data: { translations: { ru: { title: 'Джазовый вечер' } } } });
      await prisma.ticketType.update({ where: { id: shop.typeId }, data: { name: { en: 'General', ru: 'Входной' } } });
      const { body: order } = await checkout(shop.slug, shop.typeId, { locale: 'ru', buyerPhone: '+37491111111' }).expect(201);
      const path = `/api/v1/ticket-orders/${order.accessToken as string}`;
      const context = {
        locale: 'ru', buyerName: 'Ani',
        event: { title: 'Джазовый вечер', slug: shop.slug, startsAt: '2027-10-01T18:00:00.000Z',
          endsAt: null, timezone: 'Asia/Yerevan' },
        items: [expect.objectContaining({ ticketTypeId: shop.typeId, name: 'Входной' })],
      };

      const read = await http().get(path).expect(200);
      const pending = await http().post(`${path}/confirm`).expect(201);
      fakeBank().simulateSuccess(`fake_${order.payment.orderNumber as string}`);
      const captured = await http().post(`${path}/confirm`).expect(201);
      const repeated = await http().post(`${path}/confirm`).expect(201);

      for (const response of [read, pending, captured, repeated]) {
        expect(response.body).toMatchObject(context);
        expect(response.headers['cache-control']).toBe('private, no-store');
        expect(JSON.stringify(response.body)).not.toMatch(/buyerEmail|buyerPhone|ani@test.local|37491111111/);
      }

      await prisma.ticketType.update({ where: { id: shop.typeId }, data: { name: { en: 'General', ru: { invalid: true } } } });
      const fallback = await http().get(path).expect(200);
      expect(fallback.body).toMatchObject({ items: [expect.objectContaining({ name: 'General' })] });
    });

    it('issues no second set when confirm is called again', async () => {
      const { order, providerRef } = await reserved(2);
      fakeBank().simulateSuccess(providerRef);
      await http().post(`/api/v1/ticket-orders/${order.accessToken as string}/confirm`).expect(201);

      const { body } = await http().post(`/api/v1/ticket-orders/${order.accessToken as string}/confirm`).expect(201);

      expect(body.status).toBe('PAID');
      expect(await prisma.ticket.count()).toBe(2);
    });

    it.each(['get', 'post'] as const)('answers 404 for an unknown access token (%s)', async (method) => {
      const path = method === 'get' ? '/api/v1/ticket-orders/no-such-token' : '/api/v1/ticket-orders/no-such-token/confirm';

      const { body } = await http()[method](path).expect(404);

      expect(body.message).toBe('Order not found');
    });

    it('refuses to confirm a cancelled order', async () => {
      const shop = await sale({ priceMinor: '0' });
      const { body: order } = await checkout(shop.slug, shop.typeId, { provider: undefined }).expect(201);
      await shop.host.post(`${shop.base}/ticket-orders/${order.orderId as string}/cancel`).expect(201);

      const { body } = await http().post(`/api/v1/ticket-orders/${order.accessToken as string}/confirm`).expect(400);

      expect(body.message).toBe('Order is cancelled');
      expect(await prisma.ticket.findMany({ where: { orderId: order.orderId as string }, select: { status: true } })).toEqual([{ status: 'VOID' }]);
    });

    it('refuses to confirm a reserved order that never started a payment', async () => {
      const { order } = await reserved(1);
      await prisma.ticketOrder.update({ where: { id: order.orderId as string }, data: { paymentOrderNumber: null } });

      const { body } = await http().post(`/api/v1/ticket-orders/${order.accessToken as string}/confirm`).expect(400);

      expect(body.message).toBe('Order has no payment to confirm');
      expect(await prisma.ticket.count()).toBe(0);
    });
  });

  describe('where the bank sends the payer back', () => {
    it.each(['https://evil.example/tickets/return', 'javascript:alert(1)'])('refuses returnUrl %s, holding nothing', async (returnUrl) => {
      const shop = await sale();

      const { body } = await checkout(shop.slug, shop.typeId, { returnUrl }).expect(400);

      expect(body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'returnUrl' })]));
      expect(JSON.stringify(body.message)).toContain('returnUrl');
      expect(await prisma.ticketOrder.count()).toBe(0);
      expect(await inventory(shop.typeId)).toEqual({ sold: 0, held: 0 });
    });

    it('sends the payer to a page of the app when one is given', async () => {
      const shop = await sale();
      const returnUrl = appPage('/checkout/done?basket=1');

      const { body } = await checkout(shop.slug, shop.typeId, { returnUrl }).expect(201);

      expect(body.payment.redirectUrl).toMatch(new RegExp(`^${escape(returnUrl)}&fakePayment=`));
    });

    it('defaults to /tickets/return on the app when omitted', async () => {
      const shop = await sale();

      const { body } = await checkout(shop.slug, shop.typeId).expect(201);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { orderNumber: body.payment.orderNumber as string } });
      expect(payment.returnUrl).toBe(appPage('/tickets/return'));
      expect(body.payment.redirectUrl).toMatch(new RegExp(`^${escape(appPage('/tickets/return'))}\\?fakePayment=`));
    });
  });

  describe('what checkout refuses', () => {
    const tomorrow = () => new Date(Date.now() + 86_400_000);
    const yesterday = () => new Date(Date.now() - 86_400_000);

    it.each([
      { label: 'an inactive type', change: () => ({ isActive: false }), quantity: 1, message: /not on sale/ },
      { label: 'a type whose sales open tomorrow', change: () => ({ salesStartAt: tomorrow() }), quantity: 1, message: /Sales have not opened/ },
      { label: 'a type whose sales closed yesterday', change: () => ({ salesEndAt: yesterday() }), quantity: 1, message: /Sales have closed/ },
      { label: 'fewer than the minimum per order', change: () => ({ minPerOrder: 2 }), quantity: 1, message: /At least 2 ticket\(s\) per order/ },
      { label: 'more than the maximum per order', change: () => ({ maxPerOrder: 2 }), quantity: 3, message: /At most 2 ticket\(s\) per order/ },
    ])('refuses $label with a 400 and holds nothing', async ({ change, quantity, message }) => {
      const shop = await sale();
      await prisma.ticketType.update({ where: { id: shop.typeId }, data: change() });

      const { body } = await checkout(shop.slug, shop.typeId, { quantity }).expect(400);

      expect(body.message).toMatch(message);
      expect(await prisma.ticketOrder.count()).toBe(0);
      expect(await inventory(shop.typeId)).toEqual({ sold: 0, held: 0 });
    });

    it.each([
      { label: 'exactly the minimum per order', change: () => ({ minPerOrder: 2 }), quantity: 2 },
      { label: 'exactly the maximum per order', change: () => ({ maxPerOrder: 2 }), quantity: 2 },
      { label: 'a type whose sales opened yesterday', change: () => ({ salesStartAt: yesterday() }), quantity: 1 },
      { label: 'a type whose sales close tomorrow', change: () => ({ salesEndAt: tomorrow() }), quantity: 1 },
    ])('accepts $label', async ({ change, quantity }) => {
      const shop = await sale();
      await prisma.ticketType.update({ where: { id: shop.typeId }, data: change() });

      const { body } = await checkout(shop.slug, shop.typeId, { quantity }).expect(201);

      expect(body.status).toBe('RESERVED');
    });

    it('does not sell a ticket type belonging to another event', async () => {
      const ours = await sale();
      const theirs = await sale();

      const { body } = await checkout(ours.slug, theirs.typeId).expect(404);

      expect(body.message).toMatch(/do not belong to this event/);
      expect(await prisma.ticketOrder.count()).toBe(0);
      expect(await inventory(theirs.typeId)).toEqual({ sold: 0, held: 0 });
    });

    it('refuses a priced basket without a provider and returns the hold', async () => {
      const shop = await sale();

      const { body } = await checkout(shop.slug, shop.typeId, { quantity: 2, provider: undefined }).expect(400);

      expect(body.message).toMatch(/choose a provider/);
      expect(await prisma.ticketOrder.count({ where: { status: { in: ['RESERVED', 'PAID'] } } })).toBe(0);
      expect(await prisma.payment.count()).toBe(0);
      expect(await inventory(shop.typeId)).toEqual({ sold: 0, held: 0 });
    });

    it('answers 404 for a slug that was never published', async () => {
      const { body } = await checkout('no-such-slug', 'any-type').expect(404);

      expect(body.message).toMatch(/No published event/);
    });

    it('stops selling once the listing is unpublished', async () => {
      const shop = await sale();
      await shop.host.post(`${shop.base}/listing/unpublish`).expect(201);

      const { body } = await checkout(shop.slug, shop.typeId).expect(404);

      expect(body.message).toMatch(/No published event/);

      expect(await inventory(shop.typeId)).toEqual({ sold: 0, held: 0 });
    });

    it('stops selling once the event is archived', async () => {
      const shop = await sale();
      await shop.host.post(`${shop.base}/archive`).expect(201);

      const { body } = await checkout(shop.slug, shop.typeId).expect(404);

      expect(body.message).toMatch(/No published event/);

      expect(await inventory(shop.typeId)).toEqual({ sold: 0, held: 0 });
    });
  });

  describe('selling out', () => {
    it('answers 409 naming how many remain, and keeps them on sale', async () => {
      const shop = await sale({ priceMinor: '0', quantityTotal: 3 });
      await checkout(shop.slug, shop.typeId, { quantity: 2, provider: undefined }).expect(201);

      const { body } = await checkout(shop.slug, shop.typeId, { quantity: 2, provider: undefined }).expect(409);

      expect(body.message).toMatch(/Only 1 ticket\(s\) remain; 2 were requested/);
      const { body: types } = await shop.host.get(`${shop.base}/ticket-types`).expect(200);
      expect(types[0]).toMatchObject({ sold: 2, available: 1 });
    });

    it('still sells the last one', async () => {
      const shop = await sale({ priceMinor: '0', quantityTotal: 3 });
      await checkout(shop.slug, shop.typeId, { quantity: 2, provider: undefined }).expect(201);

      const { body } = await checkout(shop.slug, shop.typeId, { quantity: 1, provider: undefined }).expect(201);

      expect(body.status).toBe('PAID');
      expect(await inventory(shop.typeId)).toEqual({ sold: 3, held: 0 });
    });
  });

  describe('changing the price after sales', () => {
    const pricedOrder = async () => {
      const shop = await sale();
      const { body: order } = await checkout(shop.slug, shop.typeId, { quantity: 2 }).expect(201);
      await shop.host.patch(`${shop.base}/ticket-types/${shop.typeId}`, { priceMinor: '25000' }).expect(200);
      return { shop, order };
    };

    it('leaves a placed order at the price it captured', async () => {
      const { order } = await pricedOrder();

      const { body } = await http().get(`/api/v1/ticket-orders/${order.accessToken as string}`).expect(200);

      expect(body).toMatchObject({ totalMinor: '20000', items: [{ quantity: 2, unitPriceMinor: '10000' }] });
    });

    it('charges the next buyer the new price', async () => {
      const { shop } = await pricedOrder();

      const { body } = await checkout(shop.slug, shop.typeId).expect(201);

      expect(body).toMatchObject({ totalMinor: '25000', items: [{ unitPriceMinor: '25000' }] });
    });

    it('refunds what the earlier buyer paid, not the new price', async () => {
      const { shop, order } = await pricedOrder();
      fakeBank().simulateSuccess(`fake_${order.payment.orderNumber as string}`);
      await http().post(`/api/v1/ticket-orders/${order.accessToken as string}/confirm`).expect(201);

      const { body } = await shop.host.post(`${shop.base}/ticket-orders/${order.orderId as string}/cancel`).expect(201);

      expect(body).toMatchObject({ status: 'REFUNDED', refundedMinor: '20000' });
      const payment = await prisma.payment.findUniqueOrThrow({ where: { orderNumber: order.payment.orderNumber as string } });
      expect(payment.refundedMinor).toBe(20_000n);
    });
  });

  describe('the listing', () => {
    it('refuses to publish once the event has started', async () => {
      const shop = await sale();
      await shop.host.post(`${shop.base}/listing/unpublish`).expect(201);
      await prisma.event.update({ where: { id: shop.eventId }, data: { startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() + 3_600_000) } });

      const { body } = await shop.host.post(`${shop.base}/listing/publish`).expect(400);

      expect(JSON.stringify(body.message)).toMatch(/already started/);
      expect((await prisma.eventListing.findUniqueOrThrow({ where: { eventId: shop.eventId } })).publishedAt).toBeNull();
    });

    it('takes the page down on unpublish: gone from browse and detail', async () => {
      const shop = await sale();
      expect(await browseSlugs()).toContain(shop.slug);

      await shop.host.post(`${shop.base}/listing/unpublish`).expect(201);

      expect(await browseSlugs()).not.toContain(shop.slug);
      await http().get(`/api/v1/public/events/${shop.slug}`).expect(404);
    });

    it('leaves tickets already sold valid at the door after unpublishing', async () => {
      const shop = await sale({ priceMinor: '0' });
      const { body: order } = await checkout(shop.slug, shop.typeId, { provider: undefined }).expect(201);
      const code = (order.tickets as { code: string }[])[0].code;

      await shop.host.post(`${shop.base}/listing/unpublish`).expect(201);

      expect((await prisma.ticket.findUniqueOrThrow({ where: { code } })).status).toBe('VALID');
      const { body } = await shop.host.post(`${shop.base}/tickets/${code}/admit`).expect(201);
      expect(body.code).toBe(code);
    });
  });

  describe('link previews', () => {
    const bilingual = (listing: Record<string, unknown>, visibility: 'PUBLIC' | 'UNLISTED' = 'PUBLIC') =>
      sale({ locales: ['hy', 'en'], defaultLocale: 'hy', visibility, listing: { headline: { hy: 'Ջազ', en: 'Jazz' }, summary: { en: 'An evening of jazz' }, ...listing } });

    it('describes an indexable public event for <head>, in the language negotiated', async () => {
      const shop = await bilingual({ isIndexable: true });

      const { body } = await http().get(`/api/v1/public/events/${shop.slug}`).query({ locale: 'en' }).expect(200);

      expect(body.metadata).toMatchObject({
        title: 'Jazz',
        description: 'An evening of jazz',
        locale: 'en',
        alternateLocales: ['hy'],
        canonicalPath: `/events/${shop.slug}`,
        robots: 'index,follow',
      });
    });

    it.each([
      { label: 'a public event that did not opt in', listing: {}, visibility: 'PUBLIC' as const },
      { label: 'a public event that opted out', listing: { isIndexable: false }, visibility: 'PUBLIC' as const },
      { label: 'an unlisted event even if it opted in', listing: { isIndexable: true }, visibility: 'UNLISTED' as const },
    ])('tells crawlers to stay away from $label', async ({ listing, visibility }) => {
      const shop = await bilingual(listing, visibility);

      const { body } = await http().get(`/api/v1/public/events/${shop.slug}`).expect(200);

      expect(body.metadata.robots).toBe('noindex,nofollow');
    });
  });

  describe('browsing', () => {
    it('keeps an unlisted event out of browse but opens it by link', async () => {
      const shop = await sale({ visibility: 'UNLISTED' });
      const listed = await sale();

      const slugs = await browseSlugs();

      expect(slugs).toContain(listed.slug);
      expect(slugs).not.toContain(shop.slug);
      await http().get(`/api/v1/public/events/${shop.slug}`).expect(200);
    });

    it('hides a listing scheduled to publish tomorrow from browse and detail', async () => {
      const shop = await sale();
      expect(await browseSlugs()).toContain(shop.slug);
      await prisma.eventListing.update({ where: { eventId: shop.eventId }, data: { publishedAt: new Date(Date.now() + 86_400_000) } });

      expect(await browseSlugs()).not.toContain(shop.slug);
      await http().get(`/api/v1/public/events/${shop.slug}`).expect(404);
    });

    it('hides an archived event, and its 404 carries no public metadata', async () => {
      const shop = await sale();
      expect(await browseSlugs()).toContain(shop.slug);
      await shop.host.post(`${shop.base}/archive`).expect(201);

      expect(await browseSlugs()).not.toContain(shop.slug);
      const { body } = await http().get(`/api/v1/public/events/${shop.slug}`).expect(404);
      expect(body).not.toHaveProperty('metadata');
      expect(JSON.stringify(body)).not.toContain('Jazz');
    });

    it.each([
      { asked: 'en', headline: 'Jazz' },
      { asked: 'fr', headline: 'Ջազ' },
    ])('answers browse asked in $asked with the $headline headline', async ({ asked, headline }) => {
      const shop = await sale({ locales: ['hy', 'en'], defaultLocale: 'hy', listing: { headline: { hy: 'Ջազ', en: 'Jazz' } } });

      const { body } = await http().get('/api/v1/public/events').query({ locale: asked }).expect(200);

      const card = (body.items as { slug: string; headline: string }[]).find((item) => item.slug === shop.slug);
      expect(card?.headline).toBe(headline);
    });

    it('says which language the detail page was actually answered in', async () => {
      const shop = await sale({ locales: ['hy', 'en'], defaultLocale: 'hy', listing: { headline: { hy: 'Ջազ', en: 'Jazz' } } });

      const { body } = await http().get(`/api/v1/public/events/${shop.slug}`).query({ locale: 'fr' }).expect(200);

      expect(body).toMatchObject({ locale: 'hy', headline: 'Ջազ', availableLocales: ['hy', 'en'] });
    });
  });

  describe('who may set up sales', () => {
    const viewerOf = async (shop: Sale) => as((await authenticateAs(app, prisma, { eventId: shop.eventId, role: EventRole.VIEWER })).authorization);

    it('lets a viewer read the ticket types and the listing', async () => {
      const shop = await sale();
      const viewer = await viewerOf(shop);

      const { body: types } = await viewer.get(`${shop.base}/ticket-types`).expect(200);
      const { body } = await viewer.get(`${shop.base}/listing`).expect(200);

      expect((types as { id: string }[]).map((type) => type.id)).toEqual([shop.typeId]);
      expect(body.slug).toBe(shop.slug);
    });

    it.each([
      { label: 'create a ticket type', send: (viewer: ReturnType<typeof as>, shop: Sale) => viewer.post(`${shop.base}/ticket-types`, { name: { en: 'VIP' }, priceMinor: '1', quantityTotal: 1 }) },
      { label: 'change a ticket type', send: (viewer: ReturnType<typeof as>, shop: Sale) => viewer.patch(`${shop.base}/ticket-types/${shop.typeId}`, { priceMinor: '1' }) },
      { label: 'delete a ticket type', send: (viewer: ReturnType<typeof as>, shop: Sale) => viewer.delete(`${shop.base}/ticket-types/${shop.typeId}`) },
      { label: 'edit the listing', send: (viewer: ReturnType<typeof as>, shop: Sale) => viewer.put(`${shop.base}/listing`, { headline: { en: 'Hijacked' } }) },
      { label: 'publish the listing', send: (viewer: ReturnType<typeof as>, shop: Sale) => viewer.post(`${shop.base}/listing/publish`) },
      { label: 'unpublish the listing', send: (viewer: ReturnType<typeof as>, shop: Sale) => viewer.post(`${shop.base}/listing/unpublish`) },
    ])('refuses a viewer who tries to $label, changing nothing', async ({ send }) => {
      const shop = await sale();
      const viewer = await viewerOf(shop);
      const before = await prisma.eventListing.findUniqueOrThrow({ where: { eventId: shop.eventId } });

      await send(viewer, shop).expect(403);

      const types = await prisma.ticketType.findMany({ where: { eventId: shop.eventId } });
      expect(types).toHaveLength(1);
      expect(types[0]).toMatchObject({ priceMinor: 10_000n, isActive: true });
      expect(await prisma.eventListing.findUniqueOrThrow({ where: { eventId: shop.eventId } })).toMatchObject({ publishedAt: before.publishedAt, headline: before.headline });
    });

    it('refuses the owner of another event both reading and writing', async () => {
      const shop = await sale();
      const stranger = await sale();

      await stranger.host.get(`${shop.base}/ticket-types`).expect(403);
      await stranger.host.put(`${shop.base}/listing`, { headline: { en: 'Hijacked' } }).expect(403);

      expect((await prisma.eventListing.findUniqueOrThrow({ where: { eventId: shop.eventId } })).headline).toEqual({ en: 'Jazz' });
    });
  });

  describe('checking a promo code before checkout', () => {
    const basket = (typeId: string) => [{ ticketTypeId: typeId, quantity: 2 }];
    const promoFor = async (shop: Sale, data: Record<string, unknown> = {}) => {
      const event = await prisma.event.findUniqueOrThrow({ where: { id: shop.eventId } });
      return prisma.promoCode.create({ data: { organizationId: event.organizationId, code: 'HALF', kind: DiscountKind.PERCENT, value: 50n, ...data } });
    };
    const check = (slug: string, body: object) => http().post(`/api/v1/public/events/${slug}/promo-check`).send(body);

    it('prices the basket from server prices and claims nothing', async () => {
      const shop = await sale();
      const code = await promoFor(shop, { maxRedemptions: 1 });

      const { body, status } = await check(shop.slug, { code: 'half', items: basket(shop.typeId) });

      expect(status).toBeLessThan(300);
      expect(body).toMatchObject({ code: 'HALF', isApplicable: true, subtotalMinor: '20000', discountMinor: '10000', totalMinor: '10000', currency: 'AMD' });
      expect((await prisma.promoCode.findUniqueOrThrow({ where: { id: code.id } })).redemptions).toBe(0);
    });

    it('answers 200, not 201, because a promo check is a preview that creates nothing', async () => {
      const shop = await sale();
      await promoFor(shop, { maxRedemptions: 1 });

      const { body } = await check(shop.slug, { code: 'half', items: basket(shop.typeId) }).expect(200);

      expect(body).toMatchObject({ code: 'HALF', isApplicable: true, totalMinor: '10000' });
    });

    it.each([
      { label: 'has run out', data: { maxRedemptions: 1, redemptions: 1 }, code: 'HALF', reason: /run out/ },
      { label: 'has expired', data: { validUntil: new Date(Date.now() - 86_400_000) }, code: 'HALF', reason: /expired/ },
      { label: 'is unknown', data: {}, code: 'NOPE', reason: /recognise/ },
    ])('answers, not errors, when the code $label', async ({ data, code, reason }) => {
      const shop = await sale();
      await promoFor(shop, data);

      const { body } = await check(shop.slug, { code, items: basket(shop.typeId) }).expect(200);

      expect(body).toMatchObject({ isApplicable: false, subtotalMinor: '20000', discountMinor: '0', totalMinor: '20000' });
      expect(body.reason).toMatch(reason);
    });

    it('does not quote a ticket type from another event', async () => {
      const shop = await sale();
      const other = await sale();
      await promoFor(shop);

      const { body } = await check(shop.slug, { code: 'HALF', items: basket(other.typeId) }).expect(404);

      expect(body.message).toMatch(/do not belong/);
    });

    it('answers 404 for an unknown event', async () => {
      await check('no-such-slug', { code: 'HALF', items: [{ ticketTypeId: 'x', quantity: 1 }] }).expect(404);
    });
  });
});

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
