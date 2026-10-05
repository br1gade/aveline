import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DiscountKind, EventRole, PlanTier, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
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

      expect(body.subscription.status).toBe('TRIALING');
      expect(body.invoice.number).toMatch(/^AV-\d{4}-\d{6}$/);
      expect(body.payment.redirectUrl).toEqual(expect.any(String));
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
