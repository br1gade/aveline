import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BlockType, MessageChannel, MessageStatus, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { MessageTransport } from '../../../src/modules/communications/channels/message-channel';
import { SmtpTransport } from '../../../src/modules/communications/channels/smtp.transport';
import { MESSAGE_TRANSPORTS } from '../../../src/modules/communications/communications.module';
import { CommunicationsService } from '../../../src/modules/communications/communications.service';
import { EnquiryJournal } from '../../../src/modules/sales/enquiry-journal';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { MESSAGE_COPY } from '../../../src/seed/message-copy';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const DAY_MS = 24 * 60 * 60 * 1000;
const INTAKE_ENV = ['SALES_INTAKE_ENABLED', 'SALES_INTAKE_SUPPORT_ENABLED', 'SALES_ENQUIRY_CONVERSION_ENABLED', 'SALES_INTENT_HMAC_KEY_ID', 'SALES_INTENT_HMAC_KEYS', 'SALES_PRIVACY_JOURNAL_DIR', 'SALES_PRIVACY_JOURNAL_KEY'];

/** What a deployment seeds: the template a host picks and Aveline's own message copy. */
async function seedPlatformDefaults(prisma: PrismaClient): Promise<void> {
  await prisma.designTemplate.create({
    data: {
      key: 'classic', name: 'Classic', allowedFonts: ['Inter'],
      palettes: [{ name: 'ivory-gold', colors: ['#fffaf0', '#b8860b'] }],
      supportedBlocks: [BlockType.HERO, BlockType.VENUE, BlockType.RSVP],
      defaultTheme: { bodyFont: 'Inter', palette: 'ivory-gold' },
    },
  });
  await prisma.messageTemplate.createMany({ data: MESSAGE_COPY.map((template) => ({ ...template, organizationId: null })) });
}

/** The account-invite token the owner's email carries. */
function inviteTokenIn(body: string): string {
  const match = /[?&]token=([^&\s"'<>]+)/.exec(body);
  if (!match) throw new Error(`No invite link in message: ${body}`);
  return decodeURIComponent(match[1]);
}

/** The personal guest link a sent invitation carries. */
function guestLinkIn(body: string): string {
  const match = /\/invitations\/([^/\s]+)\/g\/([^/\s"'<>]+)/.exec(body);
  if (!match) throw new Error(`No personal link in message: ${body}`);
  return `/invitations/${match[1]}/g/${match[2]}`;
}

/**
 * Journey 09, the sales-led path: a prospect phones, staff take the enquiry,
 * book and hold a consultation, move it through its stages and convert it.
 * Conversion hands the customer a draft event and an owner invite; the
 * customer accepts, signs in and runs the event themselves — import, publish,
 * send — and a guest answers. Every step is HTTP through the real AppModule;
 * only the outbox dispatch is driven in-process, as the scheduler would.
 */
describe('Journey 09: enquiry, consultation, conversion, owner runs the event (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let journalDirectory: string;

  const http = () => request(app.getHttpServer() as Server);
  const api = (path: string) => `/api/v1${path}`;

  beforeAll(async () => {
    journalDirectory = await mkdtemp(join(tmpdir(), 'journey-09-journal-'));
    await new EnquiryJournal(journalDirectory, 'j'.repeat(32)).initialize();
    Object.assign(process.env, {
      SALES_INTAKE_ENABLED: 'true', SALES_INTAKE_SUPPORT_ENABLED: 'true', SALES_ENQUIRY_CONVERSION_ENABLED: 'true',
      SALES_INTENT_HMAC_KEY_ID: 'test', SALES_INTENT_HMAC_KEYS: JSON.stringify({ test: 'x'.repeat(32) }),
      SALES_PRIVACY_JOURNAL_DIR: journalDirectory, SALES_PRIVACY_JOURNAL_KEY: 'j'.repeat(32),
    });
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    // The outbox is driven in-process; a wall-clock cron would race the counts.
    for (const job of app.get(SchedulerRegistry).getCronJobs().values()) await job.stop();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    await seedPlatformDefaults(prisma);
  });

  afterAll(async () => {
    if (app) {
      const email = app.get<Map<MessageChannel, MessageTransport>>(MESSAGE_TRANSPORTS).get(MessageChannel.EMAIL);
      if (email instanceof SmtpTransport) email.close();
      await app.close();
    }
    await disconnectTestDatabase();
    await rm(journalDirectory, { recursive: true, force: true });
    for (const key of INTAKE_ENV) delete process.env[key];
  });

  const staff = async (role: 'ADMIN' | 'SUPPORT') => {
    const actor = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: actor.userId }, data: { platformRole: role } });
    return actor;
  };

  const GUEST_CSV = [
    'First name,Last name,Email,Household,Seats,Side,Locale',
    'Armen,Petrosyan,armen@journey09.test,Petrosyan family,2,A,en',
    'Lusine,Petrosyan,,Petrosyan family,2,A,en',
    'Mariam,Sargsyan,mariam@journey09.test,Sargsyan,1,B,en',
    'Gor,Nocontact,,Nocontact,1,A,',
  ].join('\n');

  /** Steps 1–3: intake, assignment, a held consultation, stage moves. */
  const takeEnquiry = async () => {
    const [admin, support] = await Promise.all([staff('ADMIN'), staff('SUPPORT')]);
    const as = <T extends request.Test>(call: T, actor: { authorization: string }, key: string) =>
      call.set('Authorization', actor.authorization).set('Idempotency-Key', key);

    const { body: created } = await as(http().post(api('/sales/enquiries')), admin, 'j09-create-enquiry').send({
      contact: { name: 'Anna Petrosyan', email: 'anna@journey09.test', phone: '+37499123456' },
      requirements: { eventType: 'WEDDING', estimatedGuestCount: 80 },
      source: 'PHONE', assignedUserId: null,
    }).expect(201);
    expect(created.enquiry).toMatchObject({ stage: 'NEW', assignedUserId: null, revision: 1, organizationId: null, eventId: null, conversion: null });
    const enquiryId = created.enquiry.id as string;

    const { body: assigned } = await as(http().post(api(`/sales/enquiries/${enquiryId}/assignment`)), admin, 'j09-assign-enquiry')
      .send({ expectedRevision: 1, assignedUserId: support.userId }).expect(200);
    expect(assigned.enquiry).toMatchObject({ assignedUserId: support.userId, revision: 2 });

    // The assignee now sees the case in their queue.
    const { body: queue } = await http().get(api('/sales/enquiries')).set('Authorization', support.authorization).expect(200);
    expect((queue.items as { id: string }[]).map((item) => item.id)).toEqual([enquiryId]);

    const { body: booked } = await as(http().post(api(`/sales/enquiries/${enquiryId}/consultations`)), support, 'j09-book-consultation').send({
      expectedRevision: 2, operatorUserId: support.userId,
      startsAt: '2026-11-10T10:00:00Z', endsAt: '2026-11-10T11:00:00Z', timezone: 'Asia/Yerevan',
    }).expect(201);
    expect(booked.enquiry.revision).toBe(3);
    const consultationId = booked.resultId as string;
    const { body: availability } = await http().get(api('/sales/consultation-availability'))
      .query({ operatorUserId: support.userId, from: '2026-11-10T00:00:00Z', to: '2026-11-11T00:00:00Z' })
      .set('Authorization', support.authorization).expect(200);
    expect(availability).toEqual({ operatorUserId: support.userId, busy: [{ startsAt: '2026-11-10T10:00:00.000Z', endsAt: '2026-11-10T11:00:00.000Z' }] });

    const { body: inConsultation } = await as(http().post(api(`/sales/enquiries/${enquiryId}/stage`)), support, 'j09-stage-consultation')
      .send({ expectedRevision: 3, stage: 'CONSULTATION' }).expect(200);
    expect(inConsultation.enquiry).toMatchObject({ stage: 'CONSULTATION', revision: 4 });
    await as(http().patch(api(`/sales/enquiries/${enquiryId}/consultations/${consultationId}`)), support, 'j09-complete-consultation')
      .send({ expectedRevision: 4, expectedConsultationRevision: 1, status: 'COMPLETED' }).expect(200);
    const { body: ready } = await as(http().post(api(`/sales/enquiries/${enquiryId}/stage`)), support, 'j09-stage-ready')
      .send({ expectedRevision: 5, stage: 'READY_FOR_QUOTE' }).expect(200);
    expect(ready.enquiry).toMatchObject({ stage: 'READY_FOR_QUOTE', revision: 6 });

    // A completed consultation no longer holds the operator's time.
    const { body: freed } = await http().get(api('/sales/consultation-availability'))
      .query({ operatorUserId: support.userId, from: '2026-11-10T00:00:00Z', to: '2026-11-11T00:00:00Z' })
      .set('Authorization', support.authorization).expect(200);
    expect(freed.busy).toEqual([]);
    const { body: consultations } = await http().get(api(`/sales/enquiries/${enquiryId}/consultations`)).set('Authorization', support.authorization).expect(200);
    expect(consultations.items).toEqual([expect.objectContaining({ id: consultationId, status: 'COMPLETED', operatorUserId: support.userId })]);
    return { support, enquiryId, revision: 6 };
  };

  /** Step 4: conversion hands over a draft event and an owner invite, nothing more. */
  const convert = async (support: { authorization: string; userId: string }, enquiryId: string, revision: number) => {
    const conversionBody = {
      expectedRevision: revision,
      organization: { create: { name: 'Petrosyan Wedding', ownerEmail: 'anna@journey09.test', ownerEmailSource: 'PRIMARY_CONTACT' } },
      event: { create: { type: 'WEDDING', title: 'Anna & Davit', templateKey: 'classic', startsAt: new Date(Date.now() + 30 * DAY_MS).toISOString(), locales: ['en'], defaultLocale: 'en' } },
    };
    const convertCall = () => http().post(api(`/sales/enquiries/${enquiryId}/conversion`))
      .set('Authorization', support.authorization).set('Idempotency-Key', 'j09-convert-enquiry').send(conversionBody);
    const { body: converted, headers } = await convertCall().expect(201);
    expect(headers['cache-control']).toBe('private, no-store');
    const { organizationId, eventId, ownerInviteId } = converted.conversion as { organizationId: string; eventId: string; ownerInviteId: string };
    expect(converted.enquiry).toMatchObject({ organizationId, eventId, stage: 'READY_FOR_QUOTE', revision: revision + 1 });
    expect(await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).toMatchObject({ organizationId, status: 'DRAFT', title: 'Anna & Davit' });
    expect(await prisma.organizationInvite.findUniqueOrThrow({ where: { id: ownerInviteId } })).toMatchObject({ organizationId, email: 'anna@journey09.test', role: 'OWNER', acceptedAt: null });
    // Staff never become a member of what they set up, and no payment is taken.
    expect(await prisma.organizationMembership.count({ where: { userId: support.userId } })).toBe(0);
    expect(await prisma.eventMembership.count({ where: { userId: support.userId } })).toBe(0);
    expect(await prisma.payment.count()).toBe(0);

    // A retried click replays the same setup instead of opening a second one.
    const { body: replay } = await convertCall().expect(200);
    expect(replay.conversion).toEqual(converted.conversion);
    expect(await prisma.organization.count()).toBe(1);
    expect(await prisma.event.count()).toBe(1);
    expect(await prisma.message.count({ where: { templateKey: 'organization.invite' } })).toBe(1);

    const { body: activities } = await http().get(api(`/sales/enquiries/${enquiryId}/activities`)).set('Authorization', support.authorization).expect(200);
    expect((activities.items as { kind: string }[]).map((activity) => activity.kind).reverse())
      .toEqual(['CREATE', 'ASSIGN', 'CONSULTATION_CREATE', 'STAGE', 'CONSULTATION_UPDATE', 'STAGE', 'CONVERT']);
    return { organizationId, eventId };
  };

  /** Step 5: the owner email goes out; the customer accepts it and signs in. */
  const ownerAccepts = async () => {
    expect(await app.get(CommunicationsService).dispatchDue()).toMatchObject({ sent: 1, failed: 0 });
    const invite = await prisma.message.findFirstOrThrow({ where: { templateKey: 'organization.invite' } });
    expect(invite).toMatchObject({ toAddress: 'anna@journey09.test', status: MessageStatus.SENT });
    const inviteToken = inviteTokenIn(invite.body);
    await http().post(api('/invites/accept')).send({ token: inviteToken, name: 'Anna', password: 'annas-own-password' }).expect(201);
    const { body: session } = await http().post(api('/auth/login')).send({ email: 'anna@journey09.test', password: 'annas-own-password' }).expect(201);
    return { authorization: `Bearer ${session.accessToken as string}`, inviteToken };
  };

  it('takes a prospect from first call to an owner who imports, publishes and sends, and a guest who answers', async () => {
    const { support, enquiryId, revision } = await takeEnquiry();
    const { organizationId, eventId } = await convert(support, enquiryId, revision);
    const { authorization: anna, inviteToken } = await ownerAccepts();

    // The customer owns the organization and sees exactly the converted event.
    const owner = await prisma.user.findUniqueOrThrow({ where: { email: 'anna@journey09.test' } });
    expect(await prisma.organizationMembership.findFirstOrThrow({ where: { organizationId, userId: owner.id } })).toMatchObject({ role: 'OWNER' });
    const { body: events } = await http().get(api('/events')).set('Authorization', anna).expect(200);
    expect(events).toEqual([expect.objectContaining({ id: eventId, title: 'Anna & Davit' })]);
    // Owning the event grants no access to the staff sales case.
    await http().get(api(`/sales/enquiries/${enquiryId}`)).set('Authorization', anna).expect(403);
    // The staff case shows the linkage and the invite's delivery, never its credential.
    const { body: detail } = await http().get(api(`/sales/enquiries/${enquiryId}`)).set('Authorization', support.authorization).expect(200);
    expect(detail).toMatchObject({ organizationId, eventId, stage: 'READY_FOR_QUOTE', deliveries: [{ state: 'QUEUED' }] });
    expect(JSON.stringify(detail)).not.toContain(inviteToken);

    // Step 6: the owner runs the event themselves.
    const { body: imported } = await http().post(api(`/events/${eventId}/guests/import`)).set('Authorization', anna)
      .attach('file', Buffer.from(GUEST_CSV), { filename: 'guests.csv', contentType: 'text/csv' }).expect(201);
    expect(imported).toMatchObject({ status: 'COMPLETED', rowsImported: 4, rowsFailed: 0 });
    const { body: event } = await http().get(api(`/events/${eventId}`)).set('Authorization', anna).expect(200);
    const slug = event.invitation.slug as string;
    // Conversion hands over a draft, not a finished event: the owner adds where it happens.
    const { body: refused } = await http().post(api(`/invitations/${slug}/publish`)).set('Authorization', anna).expect(400);
    expect(refused.message).toEqual(['Add a venue with an address, so guests know where to go']);
    await http().post(api(`/events/${eventId}/venues`)).set('Authorization', anna)
      .send({ role: 'RECEPTION', name: 'Ararat Hall', address: '1 Abovyan St, Yerevan', capacity: 120 }).expect(201);
    await http().post(api(`/invitations/${slug}/publish`)).set('Authorization', anna).expect(201);
    const { body: sent } = await http().post(api(`/invitations/${slug}/send`)).set('Authorization', anna).send({}).expect(201);
    expect(sent.queued).toBe(2);
    expect(sent.unreachable).toEqual([expect.objectContaining({ householdName: 'Nocontact' })]);
    expect(await app.get(CommunicationsService).dispatchDue()).toMatchObject({ sent: 2, failed: 0 });
    const invitations = await prisma.message.findMany({ where: { eventId, templateKey: 'invitation.send' }, orderBy: { toAddress: 'asc' } });
    expect(invitations.map((message) => [message.toAddress, message.status])).toEqual([
      ['armen@journey09.test', MessageStatus.SENT], ['mariam@journey09.test', MessageStatus.SENT],
    ]);

    // A guest opens the personal link and answers for the household; the owner sees it.
    const armen = guestLinkIn(invitations[0].body);
    const { body: page } = await http().get(api(armen)).expect(200);
    expect(page.guest).toMatchObject({ name: 'Armen Petrosyan', household: { name: 'Petrosyan family', seatsAllotted: 2 } });
    await http().post(api(`${armen}/rsvp`)).send({ status: 'ATTENDING' }).expect(201);
    const { body: dashboard } = await http().get(api(`/events/${eventId}/dashboard`)).set('Authorization', anna).expect(200);
    expect(dashboard.headcount).toMatchObject({ attending: 1 });
  });

  it('keeps conversion closed while its rollout gate is off, leaving the case and the database untouched', async () => {
    const { support, enquiryId, revision } = await takeEnquiry();
    const config = app.get(ConfigService);
    config.set('SALES_ENQUIRY_CONVERSION_ENABLED', 'false');
    try {
      await http().post(api(`/sales/enquiries/${enquiryId}/conversion`)).set('Authorization', support.authorization).set('Idempotency-Key', 'j09-gated-convert')
        .send({ expectedRevision: revision, organization: { create: { name: 'Petrosyan Wedding', ownerEmail: 'anna@journey09.test' } } }).expect(404);
    } finally {
      config.set('SALES_ENQUIRY_CONVERSION_ENABLED', 'true');
    }
    expect(await prisma.organization.count()).toBe(0);
    expect(await prisma.organizationInvite.count()).toBe(0);
    expect((await prisma.salesEnquiry.findUniqueOrThrow({ where: { id: enquiryId } })).revision).toBe(revision);
  });
});
