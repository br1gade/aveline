import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DiscountKind, EventRole, PlanTier, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { PaymentGatewayRegistry } from '../../src/modules/payments/payment-gateway.registry';
import { FakeGateway } from '../../src/modules/payments/providers/fake.gateway';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * Billing over HTTP: becoming a tenant, choosing a plan, and running a promo
 * code. The flow is tested end to end because the first step gates the rest —
 * an account with no organization cannot reach any billing surface, which is
 * the bug this batch found.
 */
describe('Billing (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const http = () => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(PaymentGatewayRegistry)
      .useValue(new PaymentGatewayRegistry([new FakeGateway()]))
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

  /** A signed-in account that owns its own organization. */
  const owner = async () => {
    const { authorization } = await authenticateAs(app, prisma);
    const { body } = await http()
      .post('/api/v1/organizations')
      .set('Authorization', authorization)
      .send({ name: 'Petrosyan Wedding' })
      .expect(201);
    return { authorization, organizationId: body.id as string };
  };

  const plan = (key: string, priceMinor: bigint) =>
    prisma.plan.create({
      data: {
        key,
        name: `Plan ${key}`,
        tier: PlanTier.MANAGED,
        priceMinor,
        interval: 'MONTHLY',
        features: ['seating', 'check-in'],
      },
    });


  describe('manual renewal HTTP contract', () => {
    async function renewableOwner() {
      const account = await owner();
      const paid = await plan('renew-http', 5000n);
      const subscription = await prisma.subscription.create({ data: { organizationId: account.organizationId, planId: paid.id,
        status: 'ACTIVE', currentPeriodStart: new Date('2026-01-01'), currentPeriodEnd: new Date('2030-01-01') } });
      return { ...account, subscription };
    }
    const renewalBody = (end: Date) => ({ provider: 'FAKE', expectedPeriodEnd: end.toISOString(), expectedPriceMinor: '5000', expectedCurrency: 'AMD', expectedInterval: 'MONTHLY' });
    it('names malformed quote fields and commits no invoice', async () => {
      const account = await renewableOwner();
      const { body } = await http().post('/api/v1/subscription/renew').set('Authorization', account.authorization)
        .send({ ...renewalBody(account.subscription.currentPeriodEnd), expectedPeriodEnd: 'yesterday', expectedPriceMinor: '-1' }).expect(400);
      expect(body.message).toEqual(expect.arrayContaining([expect.stringContaining('expectedPeriodEnd')]));
      expect(body.message).toEqual(expect.arrayContaining([expect.stringContaining('expectedPriceMinor')]));
      expect(await prisma.invoice.count()).toBe(0);
    });
    it('returns stable quote conflict codes and the exact invoice retry pointer', async () => {
      const account = await renewableOwner();
      const { body: changed } = await http().post('/api/v1/subscription/renew').set('Authorization', account.authorization)
        .send({ ...renewalBody(account.subscription.currentPeriodEnd), expectedPriceMinor: '1' }).expect(409);
      expect(changed).toMatchObject({ code: 'RENEWAL_QUOTE_CHANGED', action: 'RELOAD' });
      const { body } = await http().post('/api/v1/subscription/renew').set('Authorization', account.authorization)
        .send(renewalBody(account.subscription.currentPeriodEnd)).expect(201);
      expect(body.invoice).toMatchObject({ kind: 'RENEWAL', renewalAnchorEnd: account.subscription.currentPeriodEnd.toISOString(), periodStart: null });
      const { body: retry } = await http().post(`/api/v1/invoices/${body.invoice.number}/pay`).set('Authorization', account.authorization).send({ provider: 'FAKE' }).expect(201);
      expect(retry.invoice.number).toBe(body.invoice.number);
      expect(retry.invoice.paymentOrderNumber).toBe(retry.payment.orderNumber);
      const payment = await prisma.payment.findUniqueOrThrow({ where: { orderNumber: retry.payment.orderNumber as string } });
      expect(new URL(payment.returnUrl ?? '').searchParams.get('invoice')).toBe(body.invoice.number);
      expect(new URL(payment.returnUrl ?? '').searchParams.get('organization')).toBe(account.organizationId);
    });

    it('refuses paid renewal and invoice retry in pilot mode before issuing records', async () => {
      const account = await renewableOwner();
      const previous = process.env.PILOT_MODE;
      process.env.PILOT_MODE = 'true';
      try {
        for (const route of ['/api/v1/subscription/renew', '/api/v1/invoices/AV-2026-000001/pay']) {
          const body = route.endsWith('/renew') ? renewalBody(account.subscription.currentPeriodEnd) : { provider: 'FAKE' };
          const response = await http().post(route).set('Authorization', account.authorization).send(body).expect(403);
          expect(response.body).toMatchObject({ code: 'PAYMENTS_DISABLED' });
        }
        expect(await prisma.invoice.count()).toBe(0);
      } finally {
        if (previous === undefined) delete process.env.PILOT_MODE;
        else process.env.PILOT_MODE = previous;
      }
    });

    it('requires organization billing permission on both new actions', async () => {
      const { eventId } = await seedEvent(prisma);
      const { authorization } = await authenticateAs(app, prisma, { eventId, role: EventRole.COORDINATOR });
      await http().post('/api/v1/subscription/renew').set('Authorization', authorization).send(renewalBody(new Date('2030-01-01'))).expect(403);
      await http().post('/api/v1/invoices/AV-2026-000001/pay').set('Authorization', authorization).send({ provider: 'FAKE' }).expect(403);
    });
    it('cannot renew or retry another organization invoice', async () => {
      const account = await renewableOwner();
      const other = await owner();
      await http().post('/api/v1/subscription/renew').set('Authorization', other.authorization).set('x-aveline-organization-id', account.organizationId)
        .send(renewalBody(account.subscription.currentPeriodEnd)).expect(403);
      const { body } = await http().post('/api/v1/subscription/renew').set('Authorization', account.authorization).send(renewalBody(account.subscription.currentPeriodEnd)).expect(201);
      await http().post(`/api/v1/invoices/${body.invoice.number}/pay`).set('Authorization', other.authorization).send({ provider: 'FAKE' }).expect(404);
    });
  });
  describe('becoming a tenant', () => {
    it('creates an organization and makes the caller its owner', async () => {
      const { authorization } = await authenticateAs(app, prisma);

      const { body } = await http()
        .post('/api/v1/organizations')
        .set('Authorization', authorization)
        .send({ name: 'Petrosyan Wedding' })
        .expect(201);

      expect(body).toMatchObject({ name: 'Petrosyan Wedding', members: 1, plan: null });
    });

    // Without this step every organization-scoped route 403s, which is what
    // made the billing endpoints unreachable before.
    it('unlocks the organization-scoped surfaces', async () => {
      const { authorization } = await authenticateAs(app, prisma);

      await http().get('/api/v1/subscription').set('Authorization', authorization).expect(403);

      await http()
        .post('/api/v1/organizations')
        .set('Authorization', authorization)
        .send({ name: 'Petrosyan Wedding' })
        .expect(201);

      await http().get('/api/v1/subscription').set('Authorization', authorization).expect(200);
    });

    it('refuses a second organization, naming the one that exists', async () => {
      const { authorization } = await owner();

      const { body } = await http()
        .post('/api/v1/organizations')
        .set('Authorization', authorization)
        .send({ name: 'Another One' })
        .expect(409);

      expect(body.message).toContain('Petrosyan Wedding');
    });
  });

  describe('plans and subscriptions', () => {
    it('negotiates billing display language and captures the initiating account on a new invoice', async () => {
      const { authorization } = await owner();
      await plan('managed', 25_000n);
      await prisma.plan.update({ where: { key: 'managed' }, data: { translations: { ru: { name: 'Тариф' } } } });
      const plans = await http().get('/api/v1/plans?locale=ru').expect(200);
      expect(plans.body[0]).toMatchObject({ name: 'Plan managed', display: { locale: 'ru', name: 'Тариф',
        features: expect.arrayContaining([{ key: 'seating', label: 'Рассадка' }]) } });
      const selected = await http().post('/api/v1/subscription?locale=ru').set('Authorization', authorization)
        .set('Accept-Language', 'fr').send({ planKey: 'managed', provider: 'FAKE' }).expect(201);
      expect(selected.body.invoice.lines[0]).toMatchObject({ description: 'Plan managed (monthly)',
        display: { locale: 'ru', description: 'Тариф (ежемесячно)' } });
      expect(selected.body.invoice).not.toHaveProperty('requestedByUserId');
      const invoice = await prisma.invoice.findFirstOrThrow({ include: { requestedBy: true } });
      expect(invoice.paymentNoticeLocale).toBe('ru');
      expect(invoice.requestedBy?.email).toMatch(/^test-.*@aveline.test$/);
    });

    it('returns 404 for an unconfigured provider without creating billing records', async () => {
      const { authorization, organizationId } = await owner();
      await plan('managed', 25_000n);
      const { body } = await http().post('/api/v1/subscription')
        .set('Authorization', authorization)
        .send({ planKey: 'managed', provider: 'AMERIABANK' })
        .expect(404);
      expect(body.message).toContain('AMERIABANK is not configured');
      expect(await prisma.invoice.count({ where: { organizationId } })).toBe(0);
      expect(await prisma.subscription.count({ where: { organizationId } })).toBe(0);
      expect(await prisma.payment.count({ where: { organizationId } })).toBe(0);
    });

    it('serves the price list without a session', async () => {
      await plan('managed', 25_000n);

      const { body } = await http().get('/api/v1/plans').expect(200);

      expect(body[0]).toMatchObject({ key: 'managed', priceMinor: '25000', currency: 'AMD' });
      expect(body[0].entitlements.features).toContain('seating');
    });

    /**
     * Having no subscription is not an error — the account works on the free
     * tier — and the response is still an object, so a client never has to
     * parse an empty body.
     */
    it('reports no subscription as an object with a null inside', async () => {
      const { authorization } = await owner();

      const { body } = await http()
        .get('/api/v1/subscription')
        .set('Authorization', authorization)
        .expect(200);

      expect(body).toEqual({ subscription: null });
    });

    it('activates a free plan at once', async () => {
      const { authorization } = await owner();
      await plan('free', 0n);

      const { body } = await http()
        .post('/api/v1/subscription')
        .set('Authorization', authorization)
        .send({ planKey: 'free' })
        .expect(201);

      expect(body.subscription.status).toBe('ACTIVE');
      expect(body.invoice).toBeNull();
    });

    it('issues an invoice and a bank URL for a paid plan', async () => {
      const { authorization } = await owner();
      await plan('managed', 25_000n);

      const { body } = await http()
        .post('/api/v1/subscription')
        .set('Authorization', authorization)
        .send({ planKey: 'managed', provider: 'FAKE' })
        .expect(201);

      // No subscription until it is paid (B85).
      expect(body.subscription).toBeNull();
      expect(body.invoice.number).toMatch(/^AV-\d{4}-\d{6}$/);
      expect(body.payment.redirectUrl).toEqual(expect.any(String));
    });

    // B86: the bank sends the payer wherever this says, so an unchecked value
    // made a real payment page the first hop of a phishing redirect.
    it.each(['https://evil.example/billing/return', 'javascript:alert(1)'])(
      'refuses to send the payer back to %s, before issuing anything',
      async (returnUrl) => {
        const { authorization } = await owner();
        await plan('managed', 25_000n);

        const { body } = await http()
          .post('/api/v1/subscription')
          .set('Authorization', authorization)
          .send({ planKey: 'managed', provider: 'FAKE', returnUrl })
          .expect(400);

        expect(JSON.stringify(body.message)).toContain('returnUrl');
        expect(await prisma.invoice.count()).toBe(0);
      },
    );

    it('sends the payer back to the app by default', async () => {
      const { authorization } = await owner();
      await plan('managed', 25_000n);

      const { body } = await http()
        .post('/api/v1/subscription')
        .set('Authorization', authorization)
        .send({ planKey: 'managed', provider: 'FAKE' })
        .expect(201);

      const redirect = new URL(body.payment.redirectUrl as string);
      expect(redirect.origin).toBe(new URL(process.env.PUBLIC_APP_URL ?? 'http://localhost:5173').origin);
      expect(redirect.pathname).toBe('/billing/return');
      expect(redirect.searchParams.has('fakePayment')).toBe(true);
    });

    it('lists the invoice it issued', async () => {
      const { authorization } = await owner();
      await plan('managed', 25_000n);
      await http()
        .post('/api/v1/subscription')
        .set('Authorization', authorization)
        .send({ planKey: 'managed', provider: 'FAKE' })
        .expect(201);

      const { body } = await http()
        .get('/api/v1/invoices')
        .set('Authorization', authorization)
        .expect(200);

      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ status: 'ISSUED', totalMinor: '25000', taxMinor: '0' });
    });

    it('cancels at the end of the period, reversibly', async () => {
      const { authorization } = await owner();
      await plan('free', 0n);
      await http()
        .post('/api/v1/subscription')
        .set('Authorization', authorization)
        .send({ planKey: 'free' })
        .expect(201);

      const cancelled = await http()
        .post('/api/v1/subscription/cancel')
        .set('Authorization', authorization)
        .expect(201);
      expect(cancelled.body).toMatchObject({ cancelAtPeriodEnd: true, status: 'ACTIVE' });

      const resumed = await http()
        .post('/api/v1/subscription/resume')
        .set('Authorization', authorization)
        .expect(201);
      expect(resumed.body.cancelAtPeriodEnd).toBe(false);
    });

    it('404s an unknown plan key', async () => {
      const { authorization } = await owner();

      await http()
        .post('/api/v1/subscription')
        .set('Authorization', authorization)
        .send({ planKey: 'does-not-exist' })
        .expect(404);
    });

    it('does not let one organization read another’s invoices', async () => {
      const first = await owner();
      await plan('managed', 25_000n);
      await http()
        .post('/api/v1/subscription')
        .set('Authorization', first.authorization)
        .send({ planKey: 'managed', provider: 'FAKE' })
        .expect(201);
      const invoice = await prisma.invoice.findFirstOrThrow();

      const second = await owner();
      await http()
        .get(`/api/v1/invoices/${invoice.number}`)
        .set('Authorization', second.authorization)
        .expect(404);
    });
  });

  describe('promo codes', () => {
    const codeFor = (authorization: string, body: Record<string, unknown>) =>
      http().post('/api/v1/promo-codes').set('Authorization', authorization).send(body);

    it('creates a code and reports how much of it is left', async () => {
      const { authorization } = await owner();

      const { body } = await codeFor(authorization, {
        code: 'spring25',
        kind: DiscountKind.PERCENT,
        value: '25',
        maxRedemptions: 100,
      }).expect(201);

      expect(body).toMatchObject({ code: 'SPRING25', redemptions: 0, remaining: 100 });
    });

    it('refuses a duplicate code in the same organization', async () => {
      const { authorization } = await owner();
      await codeFor(authorization, { code: 'SPRING25', kind: DiscountKind.PERCENT, value: '25' }).expect(201);

      await codeFor(authorization, {
        code: 'spring25',
        kind: DiscountKind.PERCENT,
        value: '10',
      }).expect(409);
    });

    it.each([
      { label: 'a percentage over 100', value: '120', kind: DiscountKind.PERCENT },
      { label: 'a worthless discount', value: '0', kind: DiscountKind.FIXED },
    ])('rejects $label', async ({ value, kind }) => {
      const { authorization } = await owner();

      await codeFor(authorization, { code: 'BAD', kind, value }).expect(400);
    });

    it('deactivates rather than deleting, so order history survives', async () => {
      const { authorization } = await owner();
      const { body: created } = await codeFor(authorization, {
        code: 'SPRING25',
        kind: DiscountKind.PERCENT,
        value: '25',
      }).expect(201);

      await http()
        .delete(`/api/v1/promo-codes/${created.id}`)
        .set('Authorization', authorization)
        .expect(200);

      const { body } = await http()
        .get('/api/v1/promo-codes')
        .set('Authorization', authorization)
        .expect(200);
      expect(body).toHaveLength(1);
      expect(body[0].isActive).toBe(false);
    });

    it('will not lower a limit below what has been used', async () => {
      const { authorization, organizationId } = await owner();
      const code = await prisma.promoCode.create({
        data: {
          organizationId,
          code: 'USED',
          kind: DiscountKind.PERCENT,
          value: 25n,
          maxRedemptions: 10,
          redemptions: 4,
        },
      });

      await http()
        .patch(`/api/v1/promo-codes/${code.id}`)
        .set('Authorization', authorization)
        .send({ maxRedemptions: 2 })
        .expect(400);
    });

    // Discounts are revenue, so they are an owner's decision.
    it('refuses a coordinator who has no billing permission', async () => {
      const { eventId } = await seedEvent(prisma);
      const { authorization } = await authenticateAs(app, prisma, {
        eventId,
        role: EventRole.COORDINATOR,
      });

      await codeFor(authorization, {
        code: 'NOPE',
        kind: DiscountKind.PERCENT,
        value: '25',
      }).expect(403);
    });
  });
});
