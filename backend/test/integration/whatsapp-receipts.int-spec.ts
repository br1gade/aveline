import { MessageChannel } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { WhatsAppReceiptsService } from '../../src/modules/communications/whatsapp/whatsapp-receipts.service';
import { CommunicationsService } from '../../src/modules/communications/communications.service';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import type { MessageTransport } from '../../src/modules/communications/channels/message-channel';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';
import { seedEvent } from '../fixtures/event.fixture';

const scope = { accountId: '111', phoneNumberId: '222' };
const timestamp = () => String(Math.floor(Date.now() / 1000) - 10);
const payload = (outcome = 'delivered', code?: number) => ({ object: 'whatsapp_business_account', entry: [{ id: scope.accountId, changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: scope.phoneNumberId }, statuses: [{ id: 'wamid.synthetic', status: outcome, timestamp: timestamp(), errors: code === undefined ? undefined : [{ code, title: 'private contact details' }] }] } }] }] });

describe('durable WhatsApp receipts', () => {
  const prisma = testPrisma();
  const receipts = new WhatsAppReceiptsService(prisma as unknown as PrismaService);
  let messageId: string;
  beforeEach(async () => {
    await resetTestDatabase();
    const { eventId } = await seedEvent(prisma);
    messageId = (await prisma.message.create({ data: { eventId, channel: 'WHATSAPP', toAddress: '+37410000000', body: 'Synthetic', status: 'SENT', sentAt: new Date(), providerRef: 'wamid.synthetic', providerAccountId: scope.accountId, providerSenderId: scope.phoneNumberId } })).id;
  });
  afterAll(() => disconnectTestDatabase());

  it('durably deduplicates concurrent deliveries before reconciling', async () => {
    const body = payload();
    await Promise.all(Array.from({ length: 5 }, () => receipts.receive(body, scope)));
    expect(await prisma.whatsAppReceipt.count()).toBe(1);
    await Promise.all([receipts.reconcile(), receipts.reconcile()]);
    expect((await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).status).toBe('DELIVERED');
  });
  it('preserves read evidence through failed/sent callbacks without suppressing the number', async () => {
    await receipts.receive(payload('read'), scope); await receipts.reconcile();
    await receipts.receive(payload('failed', 131026), scope);
    await receipts.receive(payload('sent'), scope); await receipts.reconcile();
    const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
    expect(message.status).toBe('DELIVERED'); expect(message.readAt).not.toBeNull();
    expect(message.deliveryErrorCode).toBeNull(); expect(await prisma.suppression.count()).toBe(0);
  });
  it('preserves read evidence when read, failure and sent callbacks race across sweep instances', async () => {
    await Promise.all(['read', 'failed', 'sent'].map((outcome) => receipts.receive(payload(outcome, outcome === 'failed' ? 131042 : undefined), scope)));
    await Promise.all([receipts.reconcile(), receipts.reconcile()]);
    const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
    expect(message.status).toBe('DELIVERED'); expect(message.readAt).not.toBeNull();
    expect(message.deliveryFailureKind).toBeNull(); expect(await prisma.suppression.count()).toBe(0);
  });
  it.each([131026, 131049, 131005, 131042, 132001, 131048, 999999])('records failure %s without suppression, raw descriptions or automatic resend', async (code) => {
    await receipts.receive(payload('failed', code), scope); await receipts.reconcile();
    const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
    expect(message.status).toBe('FAILED'); expect(message.deliveryErrorCode).toBe(code);
    expect(message.failureReason).not.toContain('private'); expect(await prisma.suppression.count()).toBe(0);
    expect(JSON.stringify(await prisma.whatsAppReceipt.findFirstOrThrow())).not.toContain('private');
  });
  it('does not match another sender, account, channel or historical unscoped message', async () => {
    await prisma.message.update({ where: { id: messageId }, data: { providerSenderId: '999' } });
    await prisma.message.createMany({ data: [
      { channel: 'EMAIL', toAddress: 'guest@example.test', body: '', status: 'SENT', providerRef: 'wamid.synthetic', providerAccountId: scope.accountId, providerSenderId: scope.phoneNumberId },
      { channel: 'WHATSAPP', toAddress: '+37410000000', body: '', status: 'SENT', providerRef: 'wamid.synthetic', providerAccountId: '999', providerSenderId: scope.phoneNumberId },
      { channel: 'WHATSAPP', toAddress: '+37410000000', body: '', status: 'SENT', providerRef: 'wamid.synthetic' },
    ] });
    await receipts.receive(payload(), scope); await receipts.reconcile();
    expect(await prisma.message.count({ where: { status: 'DELIVERED' } })).toBe(0);
    expect((await prisma.whatsAppReceipt.findFirstOrThrow()).processedAt).toBeNull();
  });
  it('reconciles a callback durably accepted before the provider acknowledgement returns', async () => {
    await prisma.message.update({ where: { id: messageId }, data: { status: 'QUEUED', sentAt: null, providerRef: null, providerAccountId: null, providerSenderId: null } });
    const transport: MessageTransport = { channel: MessageChannel.WHATSAPP, send: async () => {
      await receipts.receive(payload('read'), scope); await receipts.reconcile();
      expect((await prisma.whatsAppReceipt.findFirstOrThrow()).processedAt).toBeNull();
      return { isDelivered: false, providerRef: 'wamid.synthetic', providerAccountId: scope.accountId, providerSenderId: scope.phoneNumberId };
    } };
    const dispatch = new CommunicationsService(prisma as unknown as PrismaService, new Map([[MessageChannel.WHATSAPP, transport]]), new SuppressionService(prisma as unknown as PrismaService));
    await dispatch.dispatchDue(); await receipts.reconcile();
    const message = await prisma.message.findUniqueOrThrow({ where: { id: messageId } });
    expect(message.status).toBe('DELIVERED'); expect(message.readAt).not.toBeNull(); expect(message.sentAt).not.toBeNull();
  });
  it('does not mutate an erased guest or reconstruct contacts from callbacks', async () => {
    await prisma.message.update({ where: { id: messageId }, data: { toAddress: '[erased]', body: '[erased]' } });
    await receipts.receive(payload('failed', 131026), scope); await receipts.reconcile();
    expect((await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).status).toBe('SENT');
    expect((await prisma.whatsAppReceipt.findFirstOrThrow()).processedAt).not.toBeNull();
  });
  it('validates a whole batch before any normalized data is inserted', async () => {
    const body = payload(); body.entry[0].changes[0].value.statuses.push({ ...body.entry[0].changes[0].value.statuses[0], timestamp: 'invalid' });
    await expect(receipts.receive(body, scope)).rejects.toThrow();
    expect(await prisma.whatsAppReceipt.count()).toBe(0);
  });
  it('rotates unmatched work fairly and prunes only expired receipt metadata', async () => {
    await prisma.whatsAppReceipt.createMany({ data: Array.from({ length: 200 }, (_, index) => ({ receiptKey: `unknown-${index}`, ...scope, providerRef: `unknown-${index}`, outcome: 'SENT', occurredAt: new Date() })) });
    await receipts.receive(payload(), scope);
    await receipts.reconcile(); await receipts.reconcile();
    expect((await prisma.message.findUniqueOrThrow({ where: { id: messageId } })).status).toBe('DELIVERED');
    await prisma.whatsAppReceipt.createMany({ data: [
      { receiptKey: 'expired-pending', ...scope, providerRef: 'unknown', outcome: 'SENT', occurredAt: new Date(), receivedAt: new Date(Date.now() - 8 * 86400000) },
      { receiptKey: 'expired-processed', ...scope, providerRef: 'unknown', outcome: 'SENT', occurredAt: new Date(), processedAt: new Date(Date.now() - 31 * 86400000) },
    ] });
    await receipts.reconcile();
    expect(await prisma.whatsAppReceipt.count({ where: { receiptKey: { startsWith: 'expired-' } } })).toBe(0);
    expect(await prisma.message.count()).toBe(1);
  });
});
