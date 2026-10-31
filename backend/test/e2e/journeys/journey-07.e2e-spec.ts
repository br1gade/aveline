import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test } from '@nestjs/testing';
import { BillingInterval, BlockType, PaymentProvider, PlanTier, PlatformRole, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PaymentGatewayRegistry } from '../../../src/modules/payments/payment-gateway.registry';
import { FakeGateway } from '../../../src/modules/payments/providers/fake.gateway';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const DAY_MS = 86_400_000;

/**
 * The catalogue a deployment seeds (seed-production), with the paid tier
 * priced and switched on — the deliberate act that file asks for before
 * selling it — plus the classic template a host creates events from.
 */
async function seedCatalogue(prisma: PrismaClient): Promise<void> {
  await prisma.designTemplate.create({
    data: {
      key: 'classic',
      name: 'Classic',
      allowedFonts: ['Noto Serif Armenian', 'Inter'],
      palettes: [{ name: 'ivory-gold', colors: ['#fffaf0', '#b8860b'] }],
      supportedBlocks: [BlockType.HERO, BlockType.VENUE, BlockType.NOTES, BlockType.RSVP],
      blockVariants: { HERO: ['full-bleed', 'split'], RSVP: ['split', 'stacked'] },
      defaultTheme: { bodyFont: 'Noto Serif Armenian', palette: 'ivory-gold' },
    },
  });
  await prisma.plan.createMany({
    data: [
      {
        key: 'invitation-free', name: 'Invitation', tier: PlanTier.INVITATION, priceMinor: 0n,
        interval: BillingInterval.PER_EVENT, maxEventsPerPeriod: 1, maxGuestsPerEvent: 150,
        invitationLifetimeDays: 90, features: [], sortOrder: 0,
      },
      {
        key: 'managed', name: 'Managed', tier: PlanTier.MANAGED, priceMinor: 25_000n,
        interval: BillingInterval.MONTHLY, maxEventsPerPeriod: 3, maxGuestsPerEvent: 400, maxLocales: 3,
        invitationLifetimeDays: null, features: ['seating', 'check-in'], sortOrder: 1,
      },
    ],
  });
}

/**
 * Journey 7: a host pays for a plan and the plan follows their invitations.
 *
 * Over HTTP through the real AppModule, each step feeding the next: become a
 * tenant, read the price list, subscribe to the paid tier, follow the bank
 * redirect (the FAKE gateway the real PaymentsModule registers stands in for
 * the bank's form), confirm the invoice, then publish an event and have a
 * guest answer it. The free fallback is run alongside, on an event published
 * before paying, so the difference the plan buys — a page that outlives the
 * free 90 days — is visible to the guests themselves. The second journey
 * cancels, resumes and refunds, and shows what a refund takes back and what
 * it deliberately does not.
 *
 * PILOT_MODE is forced off: the pilot refuses paid plans, so this chain is
 * otherwise never exercised end to end. Nothing is inserted behind the API
 * except the catalogue a deployment seeds and the passage of time, which is
 * simulated by moving the event's dates into the past.
 */
describe('Journey 07: plan, invoice, bank payment, entitlement on the invitation, cancel and refund (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let fake: FakeGateway;
  let previousPilotMode: string | undefined;

  const http = () => request(app.getHttpServer() as Server);
  const api = (path: string) => `/api/v1${path}`;

  beforeAll(async () => {
    previousPilotMode = process.env.PILOT_MODE;
    process.env.PILOT_MODE = 'false';
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
    // Reconciliation and settlement sweeps would otherwise settle the invoice
    // behind the confirm call this journey is about.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
    fake = app.get(PaymentGatewayRegistry).get(PaymentProvider.FAKE) as FakeGateway;
  });

  beforeEach(async () => {
    await resetTestDatabase();
    await seedCatalogue(prisma);
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
    if (previousPilotMode === undefined) delete process.env.PILOT_MODE;
    else process.env.PILOT_MODE = previousPilotMode;
  });

  /** Step 1: a signed-in account becomes the owner of its own organization. */
  const becomeOwner = async () => {
    const { authorization } = await authenticateAs(app, prisma);
    const { body } = await http()
      .post(api('/organizations'))
      .set('Authorization', authorization)
      .send({ name: 'Anna & Davit', kind: 'HOST' })
      .expect(201);
    expect(body).toMatchObject({ members: 1, plan: null, subscriptionStatus: null });
    return { authorization, organizationId: body.id as string };
  };

  /** Refunds are a platform admin's act, not the customer's. */
  const platformAdmin = async () => {
    const { authorization, userId } = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: userId }, data: { platformRole: PlatformRole.ADMIN } });
    return authorization;
  };

  const subscription = async (authorization: string) =>
    (await http().get(api('/subscription')).set('Authorization', authorization).expect(200)).body as {
      subscription: Record<string, unknown> | null;
    };

  /** Step 3: subscribe to the paid tier — an invoice and a bank URL, and nothing granted yet. */
  const startManaged = async (authorization: string) => {
    const { body: started } = await http()
      .post(api('/subscription'))
      .set('Authorization', authorization)
      .send({ planKey: 'managed', provider: 'FAKE' })
      .expect(201);
    expect(started.subscription).toBeNull();
    expect(started.invoice).toMatchObject({ status: 'ISSUED', totalMinor: '25000', taxMinor: '0', paidAt: null });
    const invoiceNumber = started.invoice.number as string;
    expect(invoiceNumber).toMatch(/^AV-\d{4}-\d{6}$/);
    expect(started.invoice.paymentOrderNumber).toBe(started.payment.orderNumber);
    expect(await subscription(authorization)).toEqual({ subscription: null });
    return { invoiceNumber, orderNumber: started.payment.orderNumber as string, redirectUrl: started.payment.redirectUrl as string };
  };

  /** Step 4: pay at the bank the redirect points to, come back and confirm. */
  const payAtBankAndConfirm = async (authorization: string, started: Awaited<ReturnType<typeof startManaged>>) => {
    // The payer is sent to the bank form; the bank's reference travels on the
    // URL the payer is sent back to.
    const redirect = new URL(started.redirectUrl);
    expect(redirect.pathname).toBe('/billing/return');
    const bankReference = redirect.searchParams.get('fakePayment');
    expect(bankReference).toBe(`fake_${started.orderNumber}`);
    fake.simulateSuccess(bankReference!);

    const { body: confirmed } = await http()
      .post(api(`/invoices/${started.invoiceNumber}/confirm`))
      .set('Authorization', authorization)
      .expect(201);
    expect(confirmed).toMatchObject({ number: started.invoiceNumber, status: 'PAID', paidAt: expect.any(String), totalMinor: '25000' });
    return { invoiceNumber: started.invoiceNumber, orderNumber: started.orderNumber };
  };

  const payForManaged = async (authorization: string) =>
    payAtBankAndConfirm(authorization, await startManaged(authorization));

  /** An event created, given one guest and published, as the host does it. */
  const publishEventWithGuest = async (authorization: string, title: string, firstName: string) => {
    const { body: event } = await http()
      .post(api('/events'))
      .set('Authorization', authorization)
      .send({
        type: 'WEDDING', title, templateKey: 'classic', locales: ['en'], defaultLocale: 'en',
        startsAt: new Date(Date.now() + 10 * DAY_MS).toISOString(),
        endsAt: new Date(Date.now() + 11 * DAY_MS).toISOString(),
      })
      .expect(201);
    const slug = event.invitation.slug as string;
    // What publishing requires: somewhere to answer and somewhere to go.
    await http()
      .patch(api(`/invitations/${slug}/arrangement`))
      .set('Authorization', authorization)
      .send({ blocks: [{ type: 'HERO' }, { type: 'VENUE' }, { type: 'RSVP' }] })
      .expect(200);
    await http()
      .post(api(`/events/${event.id as string}/venues`))
      .set('Authorization', authorization)
      .send({ role: 'RECEPTION', name: 'Ararat Hall', address: '1 Abovyan St, Yerevan' })
      .expect(201);
    const { body: guest } = await http()
      .post(api(`/events/${event.id as string}/guests`))
      .set('Authorization', authorization)
      .send({ firstName, lastName: 'Petrosyan', email: `${firstName.toLowerCase()}@journey07.test` })
      .expect(201);
    const { body: published } = await http()
      .post(api(`/invitations/${slug}/publish`))
      .set('Authorization', authorization)
      .expect(201);
    return {
      eventId: event.id as string,
      endsAt: event.endsAt as string,
      slug,
      guestLink: api(`/invitations/${slug}/g/${guest.token as string}`),
      published: published as Record<string, unknown>,
    };
  };

  const hostInvitation = async (authorization: string, eventId: string) =>
    (await http().get(api(`/events/${eventId}`)).set('Authorization', authorization).expect(200)).body
      .invitation as Record<string, unknown>;

  /** Months go by: the event happened 120 days ago, well past the free 90. */
  const monthsPass = (eventId: string) =>
    prisma.event.update({
      where: { id: eventId },
      data: { startsAt: new Date(Date.now() - 121 * DAY_MS), endsAt: new Date(Date.now() - 120 * DAY_MS) },
    });

  it('pays for a plan through the bank, and the invitation published on it outlives the free 90 days for its guest', async () => {
    const { authorization } = await becomeOwner();

    // Step 2: the price list a stranger sees, entitlements included.
    const { body: plans } = await http().get(api('/plans')).expect(200);
    expect(plans).toEqual([
      expect.objectContaining({
        key: 'invitation-free', priceMinor: '0', currency: 'AMD',
        entitlements: expect.objectContaining({ invitationLifetimeDays: 90 }),
      }),
      expect.objectContaining({
        key: 'managed', priceMinor: '25000', currency: 'AMD', interval: 'MONTHLY',
        entitlements: expect.objectContaining({ invitationLifetimeDays: null, maxEventsPerPeriod: 3, features: ['seating', 'check-in'] }),
      }),
    ]);

    // Step 3: the invoice is issued, and nothing is granted until it is paid —
    // an invitation published meanwhile is on the free fallback.
    const started = await startManaged(authorization);
    const free = await publishEventWithGuest(authorization, 'Engagement', 'Lusine');
    expect(free.published).toMatchObject({
      lifetimeSource: 'FREE_DEFAULT', lifetimeDays: 90, lifetimePlanKey: null,
      expiresAt: new Date(new Date(free.endsAt).getTime() + 90 * DAY_MS).toISOString(),
    });

    // Step 4: paid at the bank and confirmed.
    const paid = await payAtBankAndConfirm(authorization, started);

    // Step 5: the plan is active, and says what it entitles.
    const { subscription: active } = await subscription(authorization);
    expect(active).toMatchObject({
      status: 'ACTIVE', cancelAtPeriodEnd: false,
      plan: expect.objectContaining({ key: 'managed' }),
      entitlements: expect.objectContaining({ invitationLifetimeDays: null }),
    });
    expect(new Date(active!.currentPeriodEnd as string).getTime()).toBeGreaterThan(Date.now());
    const { body: invoices } = await http().get(api('/invoices')).set('Authorization', authorization).expect(200);
    expect(invoices).toEqual([expect.objectContaining({ number: paid.invoiceNumber, status: 'PAID', paymentOrderNumber: paid.orderNumber })]);

    // An invitation published now captures the paid plan: no expiry at all.
    const wedding = await publishEventWithGuest(authorization, 'Wedding', 'Armen');
    expect(wedding.published).toMatchObject({ lifetimeSource: 'PLAN', lifetimePlanKey: 'managed', lifetimeDays: null, expiresAt: null });
    expect(await hostInvitation(authorization, wedding.eventId)).toMatchObject({ lifetimeSource: 'PLAN', expiresAt: null, isExpired: false });

    // Both guests answer through their own links.
    for (const link of [free.guestLink, wedding.guestLink]) {
      await http().post(`${link}/rsvp`).send({ status: 'ATTENDING' }).expect(201);
    }

    await monthsPass(free.eventId);
    await monthsPass(wedding.eventId);

    // The free page has closed; the paid one still greets its guest with their answer.
    await http().get(free.guestLink).expect(404);
    const { body: page } = await http().get(wedding.guestLink).expect(200);
    expect(page.guest).toMatchObject({ rsvp: expect.objectContaining({ status: 'ATTENDING' }) });
    const { body: answer } = await http().get(`${wedding.guestLink}/rsvp`).expect(200);
    expect(answer.rsvp).toMatchObject({ status: 'ATTENDING' });

    // The host keeps both, and is told which one expired.
    expect(await hostInvitation(authorization, free.eventId)).toMatchObject({ lifetimeSource: 'FREE_DEFAULT', isExpired: true });
    expect(await hostInvitation(authorization, wedding.eventId)).toMatchObject({ expiresAt: null, isExpired: false });
    for (const event of [free, wedding]) {
      const { body: households } = await http().get(api(`/events/${event.eventId}/guests`)).set('Authorization', authorization).expect(200);
      expect((households as { guests: unknown[] }[]).flatMap((household) => household.guests))
        .toEqual([expect.objectContaining({ rsvpStatus: 'ATTENDING' })]);
    }
  });

  it('keeps a cancelled plan to the period end, resumes it, and ends it on a full refund without revoking what was already published', async () => {
    const { authorization } = await becomeOwner();
    const paid = await payForManaged(authorization);
    const wedding = await publishEventWithGuest(authorization, 'Wedding', 'Armen');
    expect(wedding.published).toMatchObject({ lifetimeSource: 'PLAN', expiresAt: null });

    // Step 6: cancelling keeps what was paid for; resuming undoes it.
    const { body: cancelled } = await http().post(api('/subscription/cancel')).set('Authorization', authorization).expect(201);
    expect(cancelled).toMatchObject({ status: 'ACTIVE', cancelAtPeriodEnd: true });
    expect((await subscription(authorization)).subscription).toMatchObject({ status: 'ACTIVE', cancelAtPeriodEnd: true });
    const { body: resumed } = await http().post(api('/subscription/resume')).set('Authorization', authorization).expect(201);
    expect(resumed).toMatchObject({ status: 'ACTIVE', cancelAtPeriodEnd: false });

    // A partial refund changes nothing; refunding the rest ends the plan now.
    const admin = await platformAdmin();
    const refund = (amountMinor: string) =>
      http().post(api(`/payments/${paid.orderNumber}/refund`)).set('Authorization', admin).send({ amountMinor, reason: 'Changed their mind' });
    expect((await refund('5000').expect(201)).body).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedMinor: '5000' });
    expect((await subscription(authorization)).subscription).toMatchObject({ status: 'ACTIVE', plan: expect.objectContaining({ key: 'managed' }) });
    const invoiceAfter = async () =>
      (await http().get(api(`/invoices/${paid.invoiceNumber}`)).set('Authorization', authorization).expect(200)).body as { status: string };
    expect((await invoiceAfter()).status).toBe('PAID');
    expect((await refund('20000').expect(201)).body).toMatchObject({ status: 'REFUNDED', refundedMinor: '25000' });

    expect((await invoiceAfter()).status).toBe('VOID');
    const { subscription: ended } = await subscription(authorization);
    expect(ended).toMatchObject({ status: 'CANCELLED' });
    expect(new Date(ended!.currentPeriodEnd as string).getTime()).toBeLessThanOrEqual(Date.now());
    const { body: refused } = await http().post(api('/subscription/resume')).set('Authorization', authorization).expect(400);
    expect(refused.message).toBe('This period has already ended; subscribe again');

    // The next invitation falls back to the free lifetime...
    const next = await publishEventWithGuest(authorization, 'Anniversary', 'Mariam');
    expect(next.published).toMatchObject({ lifetimeSource: 'FREE_DEFAULT', lifetimeDays: 90, lifetimePlanKey: null });

    // ...while the one captured on the paid plan keeps it, guest access included.
    await monthsPass(wedding.eventId);
    expect(await hostInvitation(authorization, wedding.eventId)).toMatchObject({ lifetimeSource: 'PLAN', lifetimePlanKey: 'managed', expiresAt: null });
    await http().get(wedding.guestLink).expect(200);
  });
});
