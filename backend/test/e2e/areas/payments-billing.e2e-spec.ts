import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import { UNTHROTTLED } from '../../fixtures/unthrottled.fixture';
import { EventRole, OrganizationRole, PaymentEventSource, PaymentProvider, PaymentPurpose, PlanTier, PlatformRole, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PaymentGatewayRegistry } from '../../../src/modules/payments/payment-gateway.registry';
import { PaymentsService } from '../../../src/modules/payments/payments.service';
import { FakeGateway } from '../../../src/modules/payments/providers/fake.gateway';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { attendeeRoster, ticketEvent } from '../../fixtures/tickets.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * The billing access matrix puts over eighty sign-ins inside one sixty-second
 * window here, so a faster machine passes the address limit of a hundred and
 * 429s a test by its position. rate-limiting.e2e-spec.ts owns the throttle.
 */

/**
 * The payment and billing routes over HTTP, through the real module wiring:
 * who may reach each, what each answers, and that pilot mode refuses a new
 * charge before anything is written. The FAKE gateway is the one the real
 * PaymentsModule registers under NODE_ENV=test, not a substitute.
 */
describe('Payments and billing over HTTP (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fake: FakeGateway;
  let payments: PaymentsService;

  const http = () => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ThrottlerStorage)
      .useValue(UNTHROTTLED)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
    // The five-minute money sweep reconciles every PENDING payment against this
    // same FAKE gateway: firing mid-test it captures a payment a test asserts is
    // still PENDING, or was captured by a callback, or by the admin's own sweep.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
    fake = app.get(PaymentGatewayRegistry).get(PaymentProvider.FAKE) as FakeGateway;
    payments = app.get(PaymentsService);
  });

  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  /** A signed-in account that owns its own organization. */
  const owner = async () => {
    const { authorization, userId } = await authenticateAs(app, prisma);
    const { body } = await http()
      .post('/api/v1/organizations')
      .set('Authorization', authorization)
      .send({ name: 'Petrosyan Wedding' })
      .expect(201);
    return { authorization, userId, organizationId: body.id as string };
  };

  const staff = async (role: PlatformRole) => {
    const { authorization, userId } = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: userId }, data: { platformRole: role } });
    return { authorization };
  };

  const plan = (key: string, priceMinor: bigint) =>
    prisma.plan.create({
      data: { key, name: `Plan ${key}`, tier: PlanTier.MANAGED, priceMinor, interval: 'MONTHLY' },
    });

  const withPilotMode = async (work: () => Promise<void>) => {
    const previous = process.env.PILOT_MODE;
    process.env.PILOT_MODE = 'true';
    try {
      await work();
    } finally {
      if (previous === undefined) delete process.env.PILOT_MODE;
      else process.env.PILOT_MODE = previous;
    }
  };

  let keySequence = 0;

  /** A payment our own flows started, which the payer has paid at the bank. */
  const paidAtTheBank = async (purpose: PaymentPurpose = PaymentPurpose.DEPOSIT) => {
    const organization = await prisma.organization.create({ data: { name: 'Payer Org', kind: 'HOST' } });
    const started = await payments.start({
      organizationId: organization.id,
      purpose,
      provider: PaymentProvider.FAKE,
      amountMinor: '20000',
      currency: 'AMD',
      returnUrl: 'https://aveline.test/return',
      idempotencyKey: `key-${(keySequence += 1)}`,
    });
    fake.simulateSuccess(`fake_${started.orderNumber}`);
    return started.orderNumber;
  };

  const capturedPayment = async (purpose: PaymentPurpose = PaymentPurpose.DEPOSIT) => {
    const orderNumber = await paidAtTheBank(purpose);
    await payments.confirm(orderNumber, PaymentEventSource.API);
    return orderNumber;
  };

  describe('reading and confirming a payment, unauthenticated', () => {
    it('describes the payment with amounts as strings, and nothing more', async () => {
      const orderNumber = await paidAtTheBank();

      const { body } = await http().get(`/api/v1/payments/${orderNumber}`).expect(200);

      expect(body).toEqual({
        orderNumber,
        status: 'PENDING',
        provider: 'FAKE',
        amountMinor: '20000',
        refundedMinor: '0',
        currency: 'AMD',
        redirectUrl: expect.stringContaining('fakePayment='),
        failureReason: null,
      });
    });

    it('captures on confirm when the bank says it was paid, recording a bank callback', async () => {
      const orderNumber = await paidAtTheBank();

      const { body } = await http().post(`/api/v1/payments/${orderNumber}/confirm?source=callback`).expect(201);

      expect(body).toMatchObject({ orderNumber, status: 'CAPTURED', amountMinor: '20000' });
      const captures = await prisma.paymentEvent.findMany({ where: { payment: { orderNumber }, toStatus: 'CAPTURED' } });
      expect(captures).toEqual([expect.objectContaining({ fromStatus: 'PENDING', source: PaymentEventSource.CALLBACK })]);
    });

    it.each(['', '?source=return', '?source=CALLBACK'])('records a confirm with query "%s" as the API, not the bank', async (query) => {
      const orderNumber = await paidAtTheBank();

      const { body } = await http().post(`/api/v1/payments/${orderNumber}/confirm${query}`).expect(201);

      expect(body.status).toBe('CAPTURED');
      const captures = await prisma.paymentEvent.findMany({ where: { payment: { orderNumber }, toStatus: 'CAPTURED' } });
      expect(captures).toEqual([expect.objectContaining({ source: PaymentEventSource.API })]);
    });

    it('leaves an unpaid payment pending on confirm', async () => {
      const organization = await prisma.organization.create({ data: { name: 'Payer Org', kind: 'HOST' } });
      const started = await payments.start({
        organizationId: organization.id, purpose: PaymentPurpose.DEPOSIT, provider: PaymentProvider.FAKE,
        amountMinor: '20000', currency: 'AMD', returnUrl: 'https://aveline.test/return', idempotencyKey: 'unpaid',
      });

      const { body } = await http().post(`/api/v1/payments/${started.orderNumber}/confirm`).expect(201);

      expect(body).toMatchObject({ orderNumber: started.orderNumber, status: 'PENDING' });
      expect(await prisma.paymentEvent.count({ where: { payment: { orderNumber: started.orderNumber }, toStatus: 'CAPTURED' } })).toBe(0);
    });

    it('404s an unknown order number on read and on confirm', async () => {
      await http().get('/api/v1/payments/AVL-NOPE').expect(404);
      await http().post('/api/v1/payments/AVL-NOPE/confirm').expect(404);
    });
  });

  describe('refunding through the payments endpoint', () => {
    it('lets a platform admin refund part of a captured payment', async () => {
      const orderNumber = await capturedPayment();
      const { authorization } = await staff(PlatformRole.ADMIN);

      const { body } = await http()
        .post(`/api/v1/payments/${orderNumber}/refund`)
        .set('Authorization', authorization)
        .send({ amountMinor: '100', reason: 'Goodwill' })
        .expect(201);

      expect(body).toMatchObject({ orderNumber, status: 'PARTIALLY_REFUNDED', refundedMinor: '100', amountMinor: '20000' });
      const refunds = await prisma.refund.findMany({ where: { payment: { orderNumber } } });
      expect(refunds).toEqual([expect.objectContaining({ amountMinor: 100n, status: 'COMPLETED', reason: 'Goodwill' })]);
    });

    it('refuses a concierge operator, and moves no money', async () => {
      const orderNumber = await capturedPayment();
      const { authorization } = await staff(PlatformRole.SUPPORT);

      await http()
        .post(`/api/v1/payments/${orderNumber}/refund`)
        .set('Authorization', authorization)
        .send({ amountMinor: '100' })
        .expect(403);

      expect(await prisma.refund.count()).toBe(0);
    });

    it('refuses an anonymous caller', async () => {
      const orderNumber = await capturedPayment();

      await http().post(`/api/v1/payments/${orderNumber}/refund`).send({ amountMinor: '100' }).expect(401);

      expect(await prisma.refund.count()).toBe(0);
    });

    it('sends a ticket payment to cancellation instead, with a 400', async () => {
      const orderNumber = await capturedPayment(PaymentPurpose.TICKET);
      const { authorization } = await staff(PlatformRole.ADMIN);

      const { body } = await http()
        .post(`/api/v1/payments/${orderNumber}/refund`)
        .set('Authorization', authorization)
        .send({ amountMinor: '100' })
        .expect(400);

      expect(body.message).toMatch(/Cancel the ticket order/);
      expect(await prisma.refund.count()).toBe(0);
    });

    it('404s an unknown order number for an admin', async () => {
      const { authorization } = await staff(PlatformRole.ADMIN);

      await http().post('/api/v1/payments/AVL-NOPE/refund').set('Authorization', authorization).send({ amountMinor: '100' }).expect(404);
    });

    it('409s a refund larger than what is left', async () => {
      const orderNumber = await capturedPayment();
      const { authorization } = await staff(PlatformRole.ADMIN);

      await http().post(`/api/v1/payments/${orderNumber}/refund`).set('Authorization', authorization).send({ amountMinor: '20001' }).expect(409);

      const payment = await prisma.payment.findUniqueOrThrow({ where: { orderNumber } });
      expect(payment).toMatchObject({ status: 'CAPTURED', refundedMinor: 0n });
      expect(await prisma.refund.count()).toBe(0);
    });
  });

  describe('the reconcile endpoint', () => {
    it('lets an admin sweep, answering how many it checked and changed', async () => {
      await paidAtTheBank();
      const { authorization } = await staff(PlatformRole.ADMIN);

      const { body } = await http().post('/api/v1/payments/reconcile').set('Authorization', authorization).expect(201);

      expect(body).toEqual({ checked: 1, changed: 1 });
      expect((await prisma.payment.findFirstOrThrow()).status).toBe('CAPTURED');
    });

    /** A refused sweep must not have run: the paid payment is still waiting. */
    const expectNothingSwept = async () => {
      expect((await prisma.payment.findFirstOrThrow()).status).toBe('PENDING');
    };

    it('refuses an anonymous caller', async () => {
      await paidAtTheBank();

      await http().post('/api/v1/payments/reconcile').expect(401);

      await expectNothingSwept();
    });

    it('refuses an organization owner, because it is for operations only', async () => {
      await paidAtTheBank();
      const { authorization } = await owner();

      await http().post('/api/v1/payments/reconcile').set('Authorization', authorization).expect(403);

      await expectNothingSwept();
    });

    it('refuses an event coordinator', async () => {
      await paidAtTheBank();
      const { eventId } = await seedEvent(prisma);
      const { authorization } = await authenticateAs(app, prisma, { eventId, role: EventRole.COORDINATOR });

      await http().post('/api/v1/payments/reconcile').set('Authorization', authorization).expect(403);

      await expectNothingSwept();
    });
  });

  describe('pilot mode', () => {
    it('refuses a paid plan with 403 before checking the provider, and writes nothing', async () => {
      const { authorization, organizationId } = await owner();
      await plan('managed', 25_000n);

      await withPilotMode(async () => {
        const { body } = await http()
          .post('/api/v1/subscription')
          .set('Authorization', authorization)
          .send({ planKey: 'managed', provider: 'AMERIABANK' })
          .expect(403);
        expect(body.message).toBe('Payments are disabled for the free pilot');
      });

      expect(await prisma.invoice.count({ where: { organizationId } })).toBe(0);
      expect(await prisma.invoiceCounter.count()).toBe(0);
      expect(await prisma.payment.count()).toBe(0);
      expect(await prisma.subscription.count()).toBe(0);
    });

    it('refuses a paid plan with a configured provider too', async () => {
      const { authorization } = await owner();
      await plan('managed', 25_000n);

      await withPilotMode(async () => {
        await http().post('/api/v1/subscription').set('Authorization', authorization).send({ planKey: 'managed', provider: 'FAKE' }).expect(403);
      });

      expect(await prisma.invoice.count()).toBe(0);
    });

    it('still serves the price list and activates a free plan', async () => {
      const { authorization } = await owner();
      await plan('free', 0n);
      await plan('managed', 25_000n);

      await withPilotMode(async () => {
        const { body: plans } = await http().get('/api/v1/plans').expect(200);
        expect((plans as { key: string }[]).map((listed) => listed.key).sort()).toEqual(['free', 'managed']);

        const { body } = await http().post('/api/v1/subscription').set('Authorization', authorization).send({ planKey: 'free' }).expect(201);
        expect(body).toMatchObject({ subscription: { status: 'ACTIVE', plan: { key: 'free' } }, invoice: null, payment: null });
      });
    });

    it('refuses a paid ticket checkout with 403 and creates no order or payment', async () => {
      const { slug, ticketTypeId } = await ticketEvent(prisma);
      await prisma.ticketType.update({ where: { id: ticketTypeId }, data: { priceMinor: 10_000n } });

      await withPilotMode(async () => {
        const { body } = await http()
          .post(`/api/v1/public/events/${slug}/orders`)
          .send({
            attendees: attendeeRoster(ticketTypeId, 1),
            items: [{ ticketTypeId, quantity: 1 }],
            buyerName: 'Ani',
            buyerEmail: 'ani@test.local',
            idempotencyKey: 'pilot-paid',
            provider: 'FAKE',
          })
          .expect(403);
        expect(body.message).toBe('Payments are disabled for the free pilot');
      });

      expect(await prisma.ticketOrder.count()).toBe(0);
      expect(await prisma.payment.count()).toBe(0);
      const type = await prisma.ticketType.findUniqueOrThrow({ where: { id: ticketTypeId } });
      expect({ sold: type.quantitySold, reserved: type.quantityReserved }).toEqual({ sold: 0, reserved: 0 });
    });
  });

  describe('subscribing, refused', () => {
    it('400s a paid plan with no provider, issuing nothing', async () => {
      const { authorization, organizationId } = await owner();
      await plan('managed', 25_000n);

      const { body } = await http().post('/api/v1/subscription').set('Authorization', authorization).send({ planKey: 'managed' }).expect(400);

      expect(body.message).toBe('This plan is paid; choose a provider');
      expect(await prisma.invoice.count({ where: { organizationId } })).toBe(0);
      expect(await prisma.invoiceCounter.count()).toBe(0);
    });

    it('400s an unknown provider, naming the field', async () => {
      const { authorization } = await owner();
      await plan('managed', 25_000n);

      const { body } = await http().post('/api/v1/subscription').set('Authorization', authorization).send({ planKey: 'managed', provider: 'PAYPAL' }).expect(400);

      expect(body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'provider' })]));
      expect(await prisma.invoice.count()).toBe(0);
    });

    it('404s a plan that has been withdrawn, and leaves it off the price list', async () => {
      const { authorization, organizationId } = await owner();
      await plan('managed', 25_000n);
      await prisma.plan.update({ where: { key: 'managed' }, data: { isActive: false } });

      await http().post('/api/v1/subscription').set('Authorization', authorization).send({ planKey: 'managed', provider: 'FAKE' }).expect(404);

      const { body: plans } = await http().get('/api/v1/plans').expect(200);
      expect(plans).toEqual([]);
      expect(await prisma.invoice.count({ where: { organizationId } })).toBe(0);
    });
  });

  describe('confirming an invoice', () => {
    const subscribed = async () => {
      const account = await owner();
      await plan('managed', 25_000n);
      const { body } = await http()
        .post('/api/v1/subscription')
        .set('Authorization', account.authorization)
        .send({ planKey: 'managed', provider: 'FAKE' })
        .expect(201);
      return { ...account, invoice: body.invoice as { number: string; paymentOrderNumber: string } };
    };

    const confirm = (authorization: string, number: string) =>
      http().post(`/api/v1/invoices/${number}/confirm`).set('Authorization', authorization);

    it('answers the invoice still issued, with its pending payment, before the payer has paid', async () => {
      const { authorization, invoice } = await subscribed();

      const { body } = await confirm(authorization, invoice.number).expect(201);

      expect(body).toMatchObject({
        number: invoice.number,
        status: 'ISSUED',
        paidAt: null,
        payment: { orderNumber: invoice.paymentOrderNumber, status: 'PENDING', amountMinor: '25000' },
      });
      expect((await http().get('/api/v1/subscription').set('Authorization', authorization).expect(200)).body).toEqual({ subscription: null });
    });

    it('pays the invoice and activates the plan once the bank has the money', async () => {
      const { authorization, invoice } = await subscribed();
      fake.simulateSuccess(`fake_${invoice.paymentOrderNumber}`);

      const { body } = await confirm(authorization, invoice.number).expect(201);

      expect(body).toMatchObject({ number: invoice.number, status: 'PAID', paidAt: expect.any(String) });
      const { body: current } = await http().get('/api/v1/subscription').set('Authorization', authorization).expect(200);
      expect(current.subscription).toMatchObject({ status: 'ACTIVE', plan: { key: 'managed' } });
    });

    it('answers a second confirm with the paid invoice and activates nothing twice', async () => {
      const { authorization, invoice } = await subscribed();
      fake.simulateSuccess(`fake_${invoice.paymentOrderNumber}`);
      await confirm(authorization, invoice.number).expect(201);

      const { body } = await confirm(authorization, invoice.number).expect(201);

      expect(body.status).toBe('PAID');
      expect(await prisma.subscription.count()).toBe(1);
      expect(await prisma.paymentEvent.count({ where: { toStatus: 'CAPTURED' } })).toBe(1);
    });

    it('404s another organization’s invoice and leaves it unpaid', async () => {
      const { invoice } = await subscribed();
      fake.simulateSuccess(`fake_${invoice.paymentOrderNumber}`);
      const stranger = await owner();

      await confirm(stranger.authorization, invoice.number).expect(404);

      expect((await prisma.invoice.findUniqueOrThrow({ where: { number: invoice.number } })).status).toBe('ISSUED');
    });

    it('400s an invoice that has no payment to confirm', async () => {
      const { authorization, organizationId } = await owner();
      await prisma.invoice.create({
        data: { organizationId, number: 'AV-2026-999999', status: 'ISSUED', subtotalMinor: 100n, totalMinor: 100n, paymentOrderNumber: null },
      });

      const { body } = await confirm(authorization, 'AV-2026-999999').expect(400);

      expect(body.message).toBe('This invoice has no payment to confirm');
    });
  });

  describe('invoice lines', () => {
    it('captures the plan’s line at issue, and keeps it when the price later changes', async () => {
      const { authorization } = await owner();
      await plan('managed', 25_000n);
      await http().post('/api/v1/subscription').set('Authorization', authorization).send({ planKey: 'managed', provider: 'FAKE' }).expect(201);
      const expectedLines = [{ description: 'Plan managed (monthly)', planKey: 'managed', quantity: 1, unitPriceMinor: '25000', totalMinor: '25000' }];

      const { body: listed } = await http().get('/api/v1/invoices').set('Authorization', authorization).expect(200);
      expect(listed[0]).toMatchObject({ subtotalMinor: '25000', taxMinor: '0', totalMinor: '25000', currency: 'AMD' });
      expect(listed[0].lines).toEqual(expectedLines);

      await prisma.plan.update({ where: { key: 'managed' }, data: { priceMinor: 99_000n, name: 'Renamed' } });

      const { body: reread } = await http().get(`/api/v1/invoices/${listed[0].number}`).set('Authorization', authorization).expect(200);
      expect(reread).toMatchObject({ subtotalMinor: '25000', totalMinor: '25000', taxMinor: '0' });
      expect(reread.lines).toEqual(expectedLines);
    });
  });

  describe('who may reach billing', () => {
    const routes = [
      { method: 'get', path: '/api/v1/subscription', permission: 'billing:read' },
      { method: 'post', path: '/api/v1/subscription', permission: 'billing:write', body: { planKey: 'free' } },
      { method: 'post', path: '/api/v1/subscription/cancel', permission: 'billing:write' },
      { method: 'post', path: '/api/v1/subscription/resume', permission: 'billing:write' },
      { method: 'get', path: '/api/v1/invoices', permission: 'billing:read' },
      { method: 'get', path: '/api/v1/invoices/AV-2026-000001', permission: 'billing:read' },
      { method: 'post', path: '/api/v1/invoices/AV-2026-000001/confirm', permission: 'billing:write' },
    ] as const;

    /** An account standing in the owner's organization as `role`; billing is refused by the permission. */
    const organizationMember = async (role: OrganizationRole) => {
      const account = await owner();
      const member = await authenticateAs(app, prisma);
      await prisma.organizationMembership.create({ data: { userId: member.userId, organizationId: account.organizationId, role } });
      return { authorization: member.authorization, headers: {} as Record<string, string>, isOutsideOrganization: false };
    };

    /**
     * Who is refused, and whether the refusal comes before the permission is
     * checked: an event-only coordinator and a concierge operator never get an
     * organization context on these routes at all.
     */
    const actors = {
      'an organization manager': () => organizationMember(OrganizationRole.MANAGER),
      'an organization member': () => organizationMember(OrganizationRole.MEMBER),
      'an organization viewer': () => organizationMember(OrganizationRole.VIEWER),
      'an event coordinator': async () => {
        const { eventId } = await seedEvent(prisma);
        const { authorization } = await authenticateAs(app, prisma, { eventId, role: EventRole.COORDINATOR });
        return { authorization, headers: {} as Record<string, string>, isOutsideOrganization: true };
      },
      'a concierge operator selecting the customer': async () => {
        const account = await owner();
        const { authorization } = await staff(PlatformRole.SUPPORT);
        return { authorization, headers: { 'X-Aveline-Organization-Id': account.organizationId }, isOutsideOrganization: true };
      },
    };

    const cases = Object.keys(actors).flatMap((actor) => routes.map((route) => ({ actor: actor as keyof typeof actors, ...route })));

    it.each(cases)('refuses $actor $permission on $method $path', async ({ actor, method, path, permission, ...rest }) => {
      await plan('free', 0n);
      const { authorization, headers, isOutsideOrganization } = await actors[actor]();

      const { body } = await http()[method](path).set('Authorization', authorization).set(headers).send('body' in rest ? rest.body : undefined).expect(403);

      expect(body.message).toBe(isOutsideOrganization ? 'organizationId: access is unavailable' : `This account may not ${permission}`);
      expect(await prisma.subscription.count()).toBe(0);
    });

    it('lets the owner read and change billing', async () => {
      await plan('free', 0n);
      const { authorization } = await owner();

      await http().post('/api/v1/subscription').set('Authorization', authorization).send({ planKey: 'free' }).expect(201);
      await http().get('/api/v1/subscription').set('Authorization', authorization).expect(200);
      await http().get('/api/v1/invoices').set('Authorization', authorization).expect(200);
    });
  });
});
