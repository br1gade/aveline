import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('signed email feedback HTTP boundary', () => {
  const prisma = testPrisma();
  const original = process.env.EMAIL_FEEDBACK_SECRET;
  const secret = 'a-long-random-feedback-signing-secret';
  let app: INestApplication;
  const body = () => ({ receiptKey: 'receipt-1', messageId: 'not-yet-known', outcome: 'DELIVERED', occurredAt: new Date().toISOString() });
  const http = () => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(async () => { await resetTestDatabase(); process.env.EMAIL_FEEDBACK_SECRET = secret; });
  afterAll(async () => {
    if (original === undefined) delete process.env.EMAIL_FEEDBACK_SECRET;
    else process.env.EMAIL_FEEDBACK_SECRET = original;
    await app.close(); await disconnectTestDatabase();
  });

  it('accepts signed bytes without a user session and responds 202', async () => {
    const raw = JSON.stringify(body());
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex');
    const result = await http().post('/api/v1/communications/email-feedback').set('Content-Type', 'application/json')
      .set('x-aveline-feedback-timestamp', timestamp).set('x-aveline-feedback-signature', signature).send(raw).expect(202);
    expect(result.body).toEqual({ accepted: true });
  });

  it('refuses unsigned feedback without changing the database', async () => {
    await http().post('/api/v1/communications/email-feedback').send(body()).expect(401);
    expect(await prisma.emailFeedback.count()).toBe(0);
  });

  it('reports disabled ingestion instead of trusting an absent secret', async () => {
    delete process.env.EMAIL_FEEDBACK_SECRET;
    await http().post('/api/v1/communications/email-feedback').send(body()).expect(503);
    expect(await prisma.emailFeedback.count()).toBe(0);
  });

  it('rejects native provider payloads and invalid outcomes as field errors', async () => {
    const response = await http().post('/api/v1/communications/email-feedback').send({ ...body(), outcome: 'OPENED', recipient: 'guest@example.test' }).expect(400);
    expect(response.body.message).toEqual(expect.arrayContaining([expect.stringContaining('outcome'), expect.stringContaining('recipient')]));
    expect(await prisma.emailFeedback.count()).toBe(0);
  });
});
