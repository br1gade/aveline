import { ThrottlerStorage } from '@nestjs/throttler';
import { UNTHROTTLED } from '../../fixtures/unthrottled.fixture';
import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { TemplateCapabilitiesService } from '../../../src/modules/design/templates/capabilities/template-capabilities.service';
import { TemplateGatesService } from '../../../src/modules/design/templates/template-gates.service';
import { EnquiryJournal } from '../../../src/modules/sales/enquiry-journal';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { testTemplateCapabilities } from '../../fixtures/template.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * Post-pilot journey, end to end over HTTP: a staff operator takes a phone
 * enquiry, books a consultation, converts it into a draft event for a new
 * organization; the owner accepts the emailed invitation and finds the event;
 * a platform ADMIN authors and publishes a template; the owner previews and
 * adopts it; the operator moves the case on. Each step consumes the previous
 * step's output — nothing is inserted behind the API except the message
 * template and the legacy baseline template the platform ships with.
 */
const INTAKE_ENV = { SALES_INTAKE_ENABLED: 'true', SALES_INTAKE_SUPPORT_ENABLED: 'true', SALES_ENQUIRY_CONVERSION_ENABLED: 'true', SALES_INTENT_HMAC_KEY_ID: 'test', SALES_INTENT_HMAC_KEYS: JSON.stringify({ test: 'x'.repeat(32) }), SALES_PRIVACY_JOURNAL_KEY: 'j'.repeat(32) };
const TEMPLATE_GATES = { TEMPLATE_AUTHORING_ENABLED: 'true', TEMPLATE_PUBLISH_ENABLED: 'true', TEMPLATE_ADOPTION_ENABLED: 'true', TEMPLATE_ASSETS_ENABLED: 'true' };
const definition = { name: 'Garden', allowedFonts: ['Inter'], palettes: [{ name: 'paper', colors: ['#FFFFFF'] }], supportedBlocks: ['HERO'], blockVariants: { HERO: ['split'] }, defaultTheme: { bodyFont: 'Inter', palette: 'paper' }, rendererKey: 'invitation-v1' };

describe('journey: sales enquiry to an adopted authored template', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let directory: string;
  const http = () => request(app.getHttpServer() as Server);
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'post-pilot-journey-'));
    await new EnquiryJournal(directory, 'j'.repeat(32)).initialize();
    Object.assign(process.env, { ...INTAKE_ENV, SALES_PRIVACY_JOURNAL_DIR: directory });
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).overrideProvider(ThrottlerStorage).useValue(UNTHROTTLED)
      .overrideProvider(TemplateGatesService).useValue(new TemplateGatesService(new ConfigService(TEMPLATE_GATES)))
      .overrideProvider(TemplateCapabilitiesService).useValue(testTemplateCapabilities()).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(async () => {
    await resetTestDatabase();
    await prisma.messageTemplate.create({ data: { key: 'organization.invite', channel: 'EMAIL', subject: { en: 'Join {{organizationName}}' }, body: { en: '{{link}}' } } });
    await prisma.designTemplate.create({ data: { key: 'classic', name: 'Classic', allowedFonts: ['Inter'], supportedBlocks: ['HERO', 'RSVP'] } });
  });
  afterAll(async () => {
    if (app) await app.close();
    await disconnectTestDatabase();
    await rm(directory, { recursive: true, force: true });
    for (const key of [...Object.keys(INTAKE_ENV), 'SALES_PRIVACY_JOURNAL_DIR']) delete process.env[key];
  });

  async function staff(platformRole: 'ADMIN' | 'SUPPORT') {
    const actor = await authenticateAs(app, prisma);
    await prisma.user.update({ where: { id: actor.userId }, data: { platformRole } });
    return actor;
  }
  const command = (authorization: string, path: string, key: string) => http().post(`/api/v1${path}`).set('Authorization', authorization).set('Idempotency-Key', key);

  /** Steps 1–3: the operator records the call, books a consultation and qualifies the case. */
  async function intake(support: { authorization: string; userId: string }) {
    const created = await command(support.authorization, '/sales/enquiries', 'journey-create').send({
      contact: { name: 'Anna Petrosyan', email: 'anna@example.am', phone: '+37499123456' }, source: 'PHONE', preferredLocale: 'hy',
      requirements: { eventType: 'WEDDING', approximateLocalDate: '2027-06-12', approximateTimezone: 'Asia/Yerevan', estimatedGuestCount: 120 },
    }).expect(201);
    expect(created.body).toMatchObject({ appliedRevision: 1, enquiry: { stage: 'NEW', assignedUserId: support.userId } });
    const id = created.body.enquiry.id as string;
    const booked = await command(support.authorization, `/sales/enquiries/${id}/consultations`, 'journey-consultation')
      .send({ expectedRevision: 1, operatorUserId: support.userId, startsAt: '2026-11-03T09:00:00Z', endsAt: '2026-11-03T10:00:00Z', timezone: 'Asia/Yerevan' }).expect(201);
    await command(support.authorization, `/sales/enquiries/${id}/notes`, 'journey-note').send({ expectedRevision: 2, body: 'Wants a garden theme', consultationId: booked.body.resultId }).expect(200);
    await command(support.authorization, `/sales/enquiries/${id}/stage`, 'journey-stage-consultation').send({ expectedRevision: 3, stage: 'CONSULTATION' }).expect(200);
    const availability = await http().get(`/api/v1/sales/consultation-availability?operatorUserId=${support.userId}&from=2026-11-03T00:00:00Z&to=2026-11-04T00:00:00Z`).set('Authorization', support.authorization).expect(200);
    expect(availability.body.busy).toEqual([{ startsAt: '2026-11-03T09:00:00.000Z', endsAt: '2026-11-03T10:00:00.000Z' }]);
    return id;
  }

  /** Step 4: conversion creates the organization, a DRAFT event and one owner invitation — nothing else. */
  async function convert(support: { authorization: string }, enquiryId: string) {
    const converted = await command(support.authorization, `/sales/enquiries/${enquiryId}/conversion`, 'journey-conversion').send({
      expectedRevision: 4,
      organization: { create: { name: 'Petrosyan family', ownerEmail: 'anna@example.am', ownerEmailSource: 'PRIMARY_CONTACT' } },
      event: { create: { type: 'WEDDING', title: 'Anna and Davit', startsAt: '2027-06-12T15:00:00Z', timezone: 'Asia/Yerevan', templateKey: 'classic' } },
    }).expect(201);
    const { organizationId, eventId } = converted.body.conversion as { organizationId: string; eventId: string };
    expect(converted.body.enquiry).toMatchObject({ revision: 5, organizationId, eventId });
    expect(await prisma.organizationMembership.count()).toBe(0);
    expect(await prisma.eventMembership.count()).toBe(0);
    expect(await prisma.payment.count()).toBe(0);
    const message = await prisma.message.findFirstOrThrow({ where: { templateKey: 'organization.invite' } });
    expect(message).toMatchObject({ toAddress: 'anna@example.am', channel: 'EMAIL', organizationId });
    const detail = await http().get(`/api/v1/sales/enquiries/${enquiryId}`).set('Authorization', support.authorization).expect(200);
    expect(detail.body.deliveries).toEqual([expect.objectContaining({ state: 'QUEUED' })]);
    expect(JSON.stringify(detail.body)).not.toContain(new URL(message.body).searchParams.get('token')!);
    return { organizationId, eventId, token: new URL(message.body).searchParams.get('token')! };
  }

  /** Step 5: the owner accepts the emailed link, signs in and finds the draft event. */
  async function ownerSignsIn(token: string, setup: { organizationId: string; eventId: string }) {
    const accepted = await http().post('/api/v1/invites/accept').send({ token, name: 'Anna Petrosyan', password: 'a-long-owner-password' }).expect(201);
    expect(accepted.body).toMatchObject({ organizationId: setup.organizationId, role: 'OWNER', accountCreated: true });
    const login = await http().post('/api/v1/auth/login').send({ email: 'anna@example.am', password: 'a-long-owner-password' }).expect(201);
    const authorization = `Bearer ${login.body.accessToken as string}`;
    const events = await http().get('/api/v1/events').set('Authorization', authorization).expect(200);
    expect(JSON.stringify(events.body)).toContain(setup.eventId);
    const event = await http().get(`/api/v1/events/${setup.eventId}`).set('Authorization', authorization).expect(200);
    expect(event.body).toMatchObject({ status: 'DRAFT', title: 'Anna and Davit', organizationId: setup.organizationId });
    return { authorization, slug: event.body.invitation.slug as string };
  }

  /** Step 6: a platform ADMIN authors, previews and publishes a shared template. */
  async function publishTemplate(admin: { authorization: string }) {
    const created = await http().post('/api/v1/design-templates').set('Authorization', admin.authorization).send({ key: 'garden', definition }).expect(201);
    const base = `/api/v1/design-templates/${created.body.templateId as string}/drafts/${created.body.draft.id as string}`;
    const validated = await http().post(`${base}/validate`).set('Authorization', admin.authorization).expect(201);
    expect(validated.body).toMatchObject({ errors: [], canPublish: true });
    const preview = await http().post(`${base}/preview`).set('Authorization', admin.authorization).expect(201);
    const published = await http().post(`${base}/publish`).set('Authorization', admin.authorization)
      .send({ expectedRevision: 1, previewId: preview.body.previewId, contentHash: preview.body.contentHash, idempotencyKey: randomUUID() }).expect(201);
    expect(published.body).toMatchObject({ versionNumber: 1, contentHash: preview.body.contentHash });
    return published.body.versionId as string;
  }

  /** Step 7: the owner sees it in the catalogue, previews it against the draft design and adopts it. */
  async function adopt(owner: { authorization: string; slug: string }, input: { eventId: string; versionId: string }) {
    const catalogue = await http().get(`/api/v1/events/${input.eventId}/design-templates`).set('Authorization', owner.authorization).expect(200);
    expect(catalogue.body).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'garden', versionId: input.versionId, scope: 'SHARED' })]));
    const before = await http().get(`/api/v1/invitations/${owner.slug}/design`).set('Authorization', owner.authorization).expect(200);
    expect(before.body.template).toMatchObject({ key: 'classic' });
    const preview = await http().post(`/api/v1/invitations/${owner.slug}/template-upgrade-preview`).set('Authorization', owner.authorization)
      .send({ targetVersionId: input.versionId, expectedDesignRevision: before.body.designRevision }).expect(201);
    expect(preview.body).toMatchObject({ state: 'READY', sourceVersionId: before.body.template.versionId, targetVersionId: input.versionId });
    const confirm = { templateKey: 'garden', templateVersionId: input.versionId, previewId: preview.body.previewId, expectedTemplateVersionId: before.body.template.versionId, expectedDesignRevision: before.body.designRevision, idempotencyKey: randomUUID() };
    await http().post(`/api/v1/invitations/${owner.slug}/template`).set('Authorization', owner.authorization).send(confirm).expect(201);
    await http().post(`/api/v1/invitations/${owner.slug}/template`).set('Authorization', owner.authorization).send(confirm).expect(201);
    const after = await http().get(`/api/v1/invitations/${owner.slug}/design`).set('Authorization', owner.authorization).expect(200);
    expect(after.body.template).toMatchObject({ key: 'garden', versionId: input.versionId, versionNumber: 1 });
    expect(after.body.designRevision).not.toBe(before.body.designRevision);
  }

  it('takes a staff-recorded enquiry through conversion, owner sign-in and authored template adoption', async () => {
    const [support, admin] = [await staff('SUPPORT'), await staff('ADMIN')];
    const enquiryId = await intake(support);
    const setup = await convert(support, enquiryId);
    const owner = await ownerSignsIn(setup.token, setup);
    const versionId = await publishTemplate(admin);
    await adopt(owner, { eventId: setup.eventId, versionId });

    expect((await prisma.invitation.findFirstOrThrow({ where: { eventId: setup.eventId } })).templateVersionId).toBe(versionId);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: setup.eventId } })).status).toBe('DRAFT');
    await http().get(`/api/v1/sales/enquiries/${enquiryId}`).set('Authorization', owner.authorization).expect(403);

    const quoted = await command(support.authorization, `/sales/enquiries/${enquiryId}/stage`, 'journey-stage-quote').send({ expectedRevision: 5, stage: 'READY_FOR_QUOTE' }).expect(200);
    expect(quoted.body.enquiry).toMatchObject({ stage: 'READY_FOR_QUOTE', revision: 6, organizationId: setup.organizationId, eventId: setup.eventId });
    const activities = await http().get(`/api/v1/sales/enquiries/${enquiryId}/activities`).set('Authorization', support.authorization).expect(200);
    expect((activities.body.items as { kind: string }[]).map((activity) => activity.kind)).toEqual(['STAGE', 'CONVERT', 'STAGE', 'NOTE', 'CONSULTATION_CREATE', 'CREATE']);
    const queue = await http().get('/api/v1/sales/enquiries?stage=READY_FOR_QUOTE&search=anna@example.am').set('Authorization', admin.authorization).expect(200);
    expect((queue.body.items as { id: string }[]).map((item) => item.id)).toEqual([enquiryId]);
  });
});
