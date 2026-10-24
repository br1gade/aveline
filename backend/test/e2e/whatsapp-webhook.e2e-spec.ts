import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { configureWhatsAppBodyParser } from '../../src/modules/communications/whatsapp/whatsapp-body-parser';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const path = '/api/v1/communications/whatsapp-webhook';
const secret = 'synthetic-meta-app-secret-32-bytes';
const settings = { WHATSAPP_ACCOUNT_ID: '111', WHATSAPP_PHONE_NUMBER_ID: '222', WHATSAPP_APP_SECRET: secret, WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'synthetic-verification-token-32-bytes' };
const body = () => ({ object: 'whatsapp_business_account', entry: [{ id: '111', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '222' }, statuses: [{ id: 'wamid.synthetic', status: 'delivered', timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] });
const signature = (raw: string) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

describe('Meta webhook HTTP boundary', () => {
  const prisma = testPrisma();
  const original = Object.fromEntries(Object.keys(settings).map((key) => [key, process.env[key]]));
  let app: NestExpressApplication;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    configureWhatsAppBodyParser(app);
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(async () => { await resetTestDatabase(); Object.assign(process.env, settings); });
  afterAll(async () => {
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await app.close(); await disconnectTestDatabase();
  });

  it('parses ordinary JSON authentication requests alongside the larger webhook parser', async () => {
    await http().post('/api/v1/auth/login').send({ email: 'unknown@example.test', password: 'Synthetic-password' }).expect(401);
  });

  it('echoes a verified subscription challenge verbatim with no session or cache', async () => {
    const response = await http().get(path).query({ 'hub.mode': 'subscribe', 'hub.verify_token': settings.WHATSAPP_WEBHOOK_VERIFY_TOKEN, 'hub.challenge': '001234' }).expect(200);
    expect(response.text).toBe('001234'); expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-type']).toContain('text/plain');
  });
  it('refuses an invalid verification token and missing verification configuration', async () => {
    await http().get(path).query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' }).expect(401);
    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    await http().get(path).expect(503);
  });
  it('accepts signed exact bytes and acknowledges only a durable normalized insert', async () => {
    const raw = JSON.stringify(body(), null, 2);
    await http().post(path).set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature(raw)).send(raw).expect(200, { accepted: true });
    const receipt = await prisma.whatsAppReceipt.findFirstOrThrow();
    expect(receipt.providerRef).toBe('wamid.synthetic'); expect(receipt.processedAt).toBeNull();
  });
  it('rejects forged, unsigned and reserialized payloads without changing durable state', async () => {
    const raw = JSON.stringify(body());
    await http().post(path).send(body()).expect(401);
    await http().post(path).set('Content-Type', 'application/json').set('X-Hub-Signature-256', 'sha256=' + '0'.repeat(64)).send(raw).expect(401);
    await http().post(path).set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature(raw)).send(raw + '\n').expect(401);
    expect(await prisma.whatsAppReceipt.count()).toBe(0);
  });
  it('returns unavailable for an unconfigured app or sender scope', async () => {
    const raw = JSON.stringify(body());
    delete process.env.WHATSAPP_APP_SECRET;
    await http().post(path).set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature(raw)).send(raw).expect(503);
    process.env.WHATSAPP_APP_SECRET = secret; delete process.env.WHATSAPP_ACCOUNT_ID;
    await http().post(path).set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature(raw)).send(raw).expect(503);
  });
  it('rejects an entire malformed or oversized status batch with a field error', async () => {
    const invalid = body(); invalid.entry[0].changes[0].value.statuses.push({ id: 'bad', status: 'failed', timestamp: 'not-time' });
    const raw = JSON.stringify(invalid);
    const response = await http().post(path).set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature(raw)).send(raw).expect(400);
    expect(response.body.message).toContain('timestamp');
    const tooMany = body(); tooMany.entry[0].changes[0].value.statuses = Array.from({ length: 1001 }, () => body().entry[0].changes[0].value.statuses[0]);
    const oversized = JSON.stringify(tooMany);
    await http().post(path).set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature(oversized)).send(oversized).expect(400);
    expect(await prisma.whatsAppReceipt.count()).toBe(0);
  });
  it('supports provider payloads above the normal API body limit but caps this route at 3 MiB', async () => {
    const raw = JSON.stringify({ ...body(), providerExtension: 'x'.repeat(150000) });
    await http().post(path).set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature(raw)).send(raw).expect(200);
    const tooLarge = JSON.stringify({ ...body(), providerExtension: 'x'.repeat(3 * 1024 * 1024) });
    await http().post(path).set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature(tooLarge)).send(tooLarge).expect(413);
    expect(await prisma.whatsAppReceipt.count()).toBe(1);
  });
  it('returns a 400 for malformed JSON without reporting a server incident', async () => {
    const raw = '{invalid';
    await http().post(path).set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature(raw)).send(raw).expect(400);
    expect(await prisma.whatsAppReceipt.count()).toBe(0);
  });

  it('does not acknowledge a database failure as accepted delivery', async () => {
    const raw = JSON.stringify(body());
    const insert = jest.spyOn(prisma.whatsAppReceipt, 'createMany').mockRejectedValueOnce(new Error('Synthetic durable write unavailable'));
    try { await http().post(path).set('Content-Type', 'application/json').set('X-Hub-Signature-256', signature(raw)).send(raw).expect(500); }
    finally { insert.mockRestore(); }
    expect(await prisma.whatsAppReceipt.count()).toBe(0);
  });
});
