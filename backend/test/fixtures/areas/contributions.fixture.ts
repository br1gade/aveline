import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { SerializeInterceptor } from '../../../src/common/interceptors/serialize';
import { buildPrivateStorage, PRIVATE_STORAGE, PrivateStorageService } from '../../../src/infra/storage/private/private-storage';
import { PrivateMediaRunner } from '../../../src/modules/guest-contributions/private-media-runner';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../auth.fixture';
import { seedEvent } from '../event.fixture';

/** The real AppModule with private storage in a throwaway directory, as acknowledgements-gallery.e2e-spec.ts builds it. */
export async function contributionsApp(prisma: PrismaClient) {
  const root = await mkdtemp(join(tmpdir(), 'aveline-contributions-coverage-http-'));
  const storage = buildPrivateStorage(new ConfigService({ S3_ENDPOINT: '', STORAGE_ROOT: join(root, 'public'), PRIVATE_STORAGE_ROOT: join(root, 'private') }));
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService).useValue(prisma).overrideProvider(PRIVATE_STORAGE).useValue(storage).compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.useGlobalInterceptors(new SerializeInterceptor());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.init();
  const close = async () => { await app.close(); await rm(root, { recursive: true, force: true }); };
  return { app, close };
}

export type ContributionsHttp = ReturnType<typeof contributionsHelpers>;

/** Requests and seeds every contributions spec needs; each returns what the next step feeds on. */
export function contributionsHelpers(app: INestApplication, prisma: PrismaClient) {
  const http = () => request(app.getHttpServer() as Server);
  const runWorker = () => new PrivateMediaRunner(prisma as unknown as PrismaService, app.get(PrivateStorageService)).runOne();
  const setup = async () => {
    const event = await seedEvent(prisma);
    const auth = await authenticateAs(app, prisma, { eventId: event.eventId });
    const guest = await prisma.guest.findUniqueOrThrow({ where: { token: event.primaryGuestToken } });
    return { ...event, ...auth, guest, base: guestBase(event.slug, event.primaryGuestToken) };
  };
  const member = async (event: { eventId: string; householdId: string; slug: string }, firstName = 'Member') => {
    const guest = await prisma.guest.create({ data: { eventId: event.eventId, householdId: event.householdId, firstName, token: randomUUID().replace(/-/g, '') } });
    return { guest, base: guestBase(event.slug, guest.token) };
  };
  const otherHousehold = async (event: { eventId: string; slug: string }) => {
    const household = await prisma.household.create({ data: { eventId: event.eventId, name: 'Other household', seatsAllotted: 2 } });
    return member({ ...event, householdId: household.id }, 'Neighbour');
  };
  const question = async (event: { slug: string; authorization: string }, required = true, prompt = 'I acknowledge the venue rules.') => {
    const { body } = await http().post(`/api/v1/invitations/${event.slug}/questions`).set('Authorization', event.authorization)
      .send({ type: 'SIGNATURE', prompt: { en: prompt }, required }).expect(201);
    return body as { id: string; statementVersionId: string };
  };
  const uploadSignature = async (base: string) => {
    const { body } = await http().post(`${base}/signature-uploads`).attach('file', await drawing(), { filename: 'signature.png', contentType: 'image/png' }).expect(201);
    return body as { id: string };
  };
  const uploadPhoto = async (base: string, caption?: string) => {
    const call = http().post(`${base}/gallery`);
    if (caption) void call.field('caption', caption);
    const { body } = await call.attach('file', await drawing(), { filename: 'photo.png', contentType: 'image/png' }).expect(201);
    return body as { id: string };
  };
  return { http, runWorker, setup, member, otherHousehold, question, uploadSignature, uploadPhoto };
}

export const guestBase = (slug: string, token: string) => `/api/v1/invitations/${slug}/g/${token}`;
export const typed = (version: string, subject: string) =>
  ({ statementVersionId: version, subjectGuestIds: [subject], method: 'TYPED', signerName: 'Primary Guest', isAcknowledged: true, locale: 'en' });
export const drawn = (version: string, subject: string, assetId: string) => ({ ...typed(version, subject), method: 'DRAWN', assetId });
export const drawing = () => sharp({ create: { width: 100, height: 40, channels: 4, background: '#000000' } }).png().toBuffer();
export const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
