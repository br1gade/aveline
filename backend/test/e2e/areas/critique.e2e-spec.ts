import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { SCHEDULE_CRON_OPTIONS } from '@nestjs/schedule/dist/schedule.constants';
import { Test } from '@nestjs/testing';
import { EventRole, MessageChannel, PaymentProvider, PaymentPurpose, PaymentStatus, PlatformRole, PrismaClient, TicketOrderStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PaymentGatewayRegistry } from '../../../src/modules/payments/payment-gateway.registry';
import { PaymentsService } from '../../../src/modules/payments/payments.service';
import { FakeGateway } from '../../../src/modules/payments/providers/fake.gateway';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const DAY_MS = 24 * 60 * 60 * 1000;
const SOURCE_ROOT = join(__dirname, '..', '..', '..', 'src');

/**
 * Business-critical surfaces an audit found reachable over HTTP but never
 * driven that way: thanking the guests who came (the last step of the core
 * loop, docs/API.md "Thanking the guests afterwards"), who may start the
 * abandoned-checkout sweep, and whether the scheduled sweeps are wired up at all.
 */
describe('Critique gaps (e2e coverage)', () => {
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
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    // Sweeps are asserted as registered, then stopped: a wall-clock release or
    // dispatch would race the HTTP calls under test.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
  });

  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  const staff = async (role: PlatformRole) => {
    const signedIn = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: signedIn.userId }, data: { platformRole: role } });
    return signedIn;
  };

  describe('thanking the guests who came', () => {
    /** An event whose host may publish, with thank-you copy and a reachable primary guest. */
    const hostedEvent = async () => {
      const seeded = await seedEvent(prisma);
      const event = await prisma.event.findUniqueOrThrow({ where: { id: seeded.eventId } });
      await prisma.messageTemplate.create({
        data: { organizationId: event.organizationId, key: 'thankyou.send', channel: MessageChannel.EMAIL,
          subject: { hy: 'Շնորհակալություն' }, body: { hy: '{{guestName}} — {{link}}' } },
      });
      await prisma.guest.updateMany({ where: { eventId: seeded.eventId }, data: { email: 'primary@test.local' } });
      const guest = await prisma.guest.findFirstOrThrow({ where: { eventId: seeded.eventId } });
      const host = await authenticateAs(app, prisma, { eventId: seeded.eventId, role: EventRole.OWNER });
      return { ...seeded, guestId: guest.id, host };
    };

    const thank = (slug: string, authorization?: string) => {
      const call = http().post(`/api/v1/invitations/${slug}/thank-you`);
      return authorization ? call.set('Authorization', authorization) : call;
    };

    const eventHappened = (eventId: string) =>
      prisma.event.update({ where: { id: eventId }, data: { startsAt: new Date(Date.now() - DAY_MS) } });

    const thankYous = (eventId: string) => prisma.message.findMany({ where: { eventId, templateKey: 'thankyou.send' } });

    it('thanks the household checked in at the door, once, and reports it as ARRIVED', async () => {
      const event = await hostedEvent();
      await http().post(`/api/v1/events/${event.eventId}/guests/${event.guestId}/check-in`)
        .set('Authorization', event.host.authorization).expect(201);
      await eventHappened(event.eventId);

      const { body } = await thank(event.slug, event.host.authorization).expect(201);

      expect(body).toMatchObject({ queued: 1, alreadyThanked: 0, basis: 'ARRIVED', notInvited: [] });
      expect(body.recipients).toEqual([expect.objectContaining({ toAddress: 'primary@test.local' })]);
      const messages = await thankYous(event.eventId);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ toAddress: 'primary@test.local', channel: MessageChannel.EMAIL, guestId: event.guestId });
    });

    it('refuses with a 400 before the event has happened, and queues nothing', async () => {
      const event = await hostedEvent();
      await prisma.checkIn.create({ data: { guestId: event.guestId } });

      const { body } = await thank(event.slug, event.host.authorization).expect(400);

      expect(JSON.stringify(body.message)).toMatch(/not happened yet/);
      expect(await thankYous(event.eventId)).toHaveLength(0);
    });

    it('requires a session', async () => {
      const event = await hostedEvent();
      await eventHappened(event.eventId);

      await thank(event.slug).expect(401);

      expect(await thankYous(event.eventId)).toHaveLength(0);
    });

    // invitation:publish: a designer shapes the page and a viewer reads; neither writes to guests.
    it.each([EventRole.DESIGNER, EventRole.VIEWER])('refuses a %s with a 403 and queues nothing', async (role) => {
      const event = await hostedEvent();
      await prisma.checkIn.create({ data: { guestId: event.guestId } });
      await eventHappened(event.eventId);
      const member = await authenticateAs(app, prisma, { eventId: event.eventId, role });

      await thank(event.slug, member.authorization).expect(403);

      expect(await thankYous(event.eventId)).toHaveLength(0);
    });

    it('lets a coordinator thank the guests, as invitation:publish allows', async () => {
      const event = await hostedEvent();
      await prisma.checkIn.create({ data: { guestId: event.guestId } });
      await eventHappened(event.eventId);
      const coordinator = await authenticateAs(app, prisma, { eventId: event.eventId, role: EventRole.COORDINATOR });

      await thank(event.slug, coordinator.authorization).expect(201);

      expect(await thankYous(event.eventId)).toHaveLength(1);
    });

    it("refuses the owner of another event, who has no standing on this one", async () => {
      const event = await hostedEvent();
      await prisma.checkIn.create({ data: { guestId: event.guestId } });
      await eventHappened(event.eventId);
      const other = await seedEvent(prisma);
      const stranger = await authenticateAs(app, prisma, { eventId: other.eventId, role: EventRole.OWNER });

      await thank(event.slug, stranger.authorization).expect(403);

      expect(await thankYous(event.eventId)).toHaveLength(0);
    });
  });

  describe('who may start the abandoned-checkout sweep', () => {
    /** A checkout whose hold lapsed, still holding two seats out of sale. */
    const abandonedCheckout = async () => {
      const seeded = await seedEvent(prisma);
      const type = await prisma.ticketType.create({
        data: { eventId: seeded.eventId, name: { en: 'Entry' }, priceMinor: 5_000n, quantityTotal: 10, quantityReserved: 2 },
      });
      const order = await prisma.ticketOrder.create({
        data: { eventId: seeded.eventId, buyerName: 'Ani', buyerEmail: 'ani@test.local', totalMinor: 10_000n, status: TicketOrderStatus.RESERVED,
          reservesUntil: new Date(Date.now() - 60_000), idempotencyKey: randomUUID(), accessToken: randomUUID(),
          items: { create: { ticketTypeId: type.id, quantity: 2, unitPriceMinor: 5_000n } } },
      });
      return { ...seeded, ticketTypeId: type.id, orderId: order.id };
    };

    const release = (authorization?: string) => {
      const call = http().post('/api/v1/ticket-orders/release-expired');
      return authorization ? call.set('Authorization', authorization) : call;
    };

    const heldSeats = async (ticketTypeId: string) =>
      (await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } })).quantityReserved;

    it.each([PlatformRole.ADMIN, PlatformRole.SUPPORT])('lets %s staff return the lapsed hold to sale', async (role) => {
      const checkout = await abandonedCheckout();
      const { authorization } = await staff(role);

      const { body } = await release(authorization).expect(201);

      expect(body).toEqual({ released: 1 });
      expect((await prisma.ticketOrder.findUniqueOrThrow({ where: { id: checkout.orderId } })).status).toBe(TicketOrderStatus.EXPIRED);
      expect(await heldSeats(checkout.ticketTypeId)).toBe(0);
    });

    // The route has no event scope, so an event role grants nothing here: a
    // customer cannot start a sweep across every customer's checkouts.
    it.each([EventRole.OWNER, EventRole.COORDINATOR])('refuses an event %s, whose event:write is scoped to their event', async (role) => {
      const checkout = await abandonedCheckout();
      const { authorization } = await authenticateAs(app, prisma, { eventId: checkout.eventId, role });

      await release(authorization).expect(403);

      expect((await prisma.ticketOrder.findUniqueOrThrow({ where: { id: checkout.orderId } })).status).toBe(TicketOrderStatus.RESERVED);
      expect(await heldSeats(checkout.ticketTypeId)).toBe(2);
    });

    it('refuses an account with no standing on any event, leaving the hold in place', async () => {
      const checkout = await abandonedCheckout();
      const { authorization } = await authenticateAs(app, prisma);

      await release(authorization).expect(403);

      expect(await heldSeats(checkout.ticketTypeId)).toBe(2);
    });

    it('refuses an anonymous caller, leaving the hold in place', async () => {
      const checkout = await abandonedCheckout();

      await release().expect(401);

      expect(await heldSeats(checkout.ticketTypeId)).toBe(2);
    });

    // The contrast the audit drew: reconcile needs billing:read, which SUPPORT
    // does not hold (ACCESS_CONTROL.md §2), although both sweeps ask the bank.
    // ADMIN's allowed half is in test/e2e/areas/payments-billing.e2e-spec.ts.
    it('refuses SUPPORT the payment reconcile sweep, so a payment the bank took stays unresolved', async () => {
      const organization = await prisma.organization.create({ data: { name: 'Payer Org', kind: 'HOST' } });
      const started = await app.get(PaymentsService).start({ organizationId: organization.id, purpose: PaymentPurpose.DEPOSIT, provider: PaymentProvider.FAKE,
        amountMinor: '20000', currency: 'AMD', returnUrl: 'https://aveline.test/return', idempotencyKey: randomUUID() });
      (app.get(PaymentGatewayRegistry).get(PaymentProvider.FAKE) as FakeGateway).simulateSuccess(`fake_${started.orderNumber}`);
      const support = await staff(PlatformRole.SUPPORT);

      await http().post('/api/v1/payments/reconcile').set('Authorization', support.authorization).expect(403);

      expect((await prisma.payment.findUniqueOrThrow({ where: { orderNumber: started.orderNumber } })).status).toBe(PaymentStatus.PENDING);
    });
  });

  describe('the scheduled sweeps', () => {
    /**
     * Every class in src whose methods carry @Cron, found from the source
     * rather than listed here, so a sweep added later is checked without
     * anyone remembering to add it.
     */
    const scheduledClasses = (): (new (...args: never[]) => object)[] =>
      globSync('**/*.ts', { cwd: SOURCE_ROOT })
        .filter((file) => !file.endsWith('.spec.ts') && readFileSync(join(SOURCE_ROOT, file), 'utf8').includes('@Cron('))
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- the files are discovered at run time
        .flatMap((file) => Object.values(require(join(SOURCE_ROOT, file)) as Record<string, unknown>))
        .filter((value): value is new (...args: never[]) => object => typeof value === 'function' && cronsOf(value).length > 0);

    const cronsOf = (type: { prototype: unknown }): string[] => Object.getOwnPropertyNames(type.prototype).flatMap((method) => {
      const handler = (type.prototype as Record<string, unknown>)[method];
      const options = typeof handler === 'function' ? Reflect.getMetadata(SCHEDULE_CRON_OPTIONS, handler) as { cronTime: string } | undefined : undefined;
      return options ? [options.cronTime] : [];
    });

    const SCHEDULED = scheduledClasses();

    it('finds the sweeps the audit named, so the checks below are not vacuous', () => {
      expect(SCHEDULED.map((type) => type.name)).toEqual(expect.arrayContaining([
        'JobsService', 'MoneySweepService', 'ReminderSweepService', 'PrivacySweepService', 'EmailFeedbackSweepService', 'ImageSweepService',
        'WhatsAppReceiptSweepService', 'InvitationMaintenanceSweepService', 'ContributionSweepService', 'SalesPrivacySweepService', 'HealthWatchService',
      ]));
    });

    it.each(SCHEDULED.map((type) => [type.name, type] as const))('provides %s in the running application', (_name, type) => {
      expect(app.get(type, { strict: false })).toBeInstanceOf(type);
    });

    // A sweep declared but never registered is inert: the lock service's own
    // comment records three that were, for weeks.
    it('registers one running schedule for every @Cron a class in src declares', () => {
      const registered = [...app.get(SchedulerRegistry).getCronJobs().values()].map((job) => job.cronTime.source as string);

      expect(registered.sort()).toEqual(SCHEDULED.flatMap(cronsOf).sort());
    });
  });
});
