import { parseWhatsAppReceipts } from './whatsapp-payload';

const scope = { accountId: '111', phoneNumberId: '222' };
const status = { id: 'wamid.synthetic', status: 'delivered', timestamp: '1792000000', recipient_id: '37410000000' };
const payload = (statuses: unknown[] = [status]) => ({ object: 'whatsapp_business_account', entry: [{ id: '111', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '222' }, statuses } }] }] });

describe('WhatsApp normalized receipt payloads', () => {
  it('keeps only scoped normalized status metadata and deduplicates stable identities', async () => {
    const [receipt] = await parseWhatsAppReceipts(payload(), scope);
    expect(receipt).toMatchObject({ ...scope, providerRef: status.id, outcome: 'DELIVERED', occurredAt: new Date(1792000000000), errorCode: null });
    expect(receipt.receiptKey).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt).not.toHaveProperty('recipient_id');
    expect(await parseWhatsAppReceipts(payload(), scope)).toEqual([receipt]);
  });
  it('ignores incoming messages, future status names and other configured accounts/senders', async () => {
    expect(await parseWhatsAppReceipts(payload([{ ...status, status: 'future_status' }, { ...status, status: 'constructor' }]), scope)).toEqual([]);
    expect(await parseWhatsAppReceipts(payload([]), scope)).toEqual([]);
    expect(await parseWhatsAppReceipts(payload(), { ...scope, accountId: '999' })).toEqual([]);
    expect(await parseWhatsAppReceipts(payload(), { ...scope, phoneNumberId: '999' })).toEqual([]);
  });
  it('ignores account-level errors without requiring message sender metadata', async () => {
    const body = { object: 'whatsapp_business_account', entry: [{ id: scope.accountId, changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', errors: [{ code: 131042 }] } }] }] };
    expect(await parseWhatsAppReceipts(body, scope)).toEqual([]);
  });
  it('accepts the documented 1000-update limit and rejects 1001 before any write', async () => {
    expect(await parseWhatsAppReceipts(payload(Array.from({ length: 1000 }, () => status)), scope)).toHaveLength(1000);
    await expect(parseWhatsAppReceipts(payload(Array.from({ length: 1001 }, () => status)), scope)).rejects.toThrow('1000');
  });
  it('bounds changes and statuses across nested arrays, rather than per array alone', async () => {
    const changes = payload();
    changes.entry = Array.from({ length: 2 }, () => ({ ...changes.entry[0], changes: Array.from({ length: 501 }, () => changes.entry[0].changes[0]) }));
    await expect(parseWhatsAppReceipts(changes, scope)).rejects.toThrow('1000 changes');
    const statuses = payload(Array.from({ length: 501 }, () => status));
    statuses.entry[0].changes.push(statuses.entry[0].changes[0]);
    await expect(parseWhatsAppReceipts(statuses, scope)).rejects.toThrow('1000 statuses');
  });
  it.each([{ ...status, timestamp: 'NaN' }, { ...status, timestamp: '9999999999' }, { ...status, id: 'x'.repeat(513) }, { ...status, errors: [{ code: '131026' }] }])('rejects malformed status fields atomically', async (invalid) => {
    await expect(parseWhatsAppReceipts(payload([status, invalid]), scope)).rejects.toThrow();
  });
  it('stores numeric failure codes without provider descriptions or contacts', async () => {
    const [receipt] = await parseWhatsAppReceipts(payload([{ ...status, status: 'failed', errors: [{ code: 131026, title: 'contains private details', error_data: { details: 'private' } }] }]), scope);
    expect(receipt.errorCode).toBe(131026);
    expect(JSON.stringify(receipt)).not.toContain('private');
  });
});
