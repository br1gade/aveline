import { deriveWhatsAppUpdate, classifyWhatsAppCode } from './whatsapp-outcome';

const at = new Date('2026-10-12T00:00:00Z');
const message = { status: 'SENT' as const, deliveredAt: null, readAt: null, providerStatusAt: null };
const receipt = { outcome: 'DELIVERED' as const, occurredAt: at, errorCode: null };

describe('WhatsApp receipt precedence', () => {
  it.each(['SENT', 'FAILED', 'SENDING'] as const)('delivery confirms %s and clears failure metadata', (status) => {
    expect(deriveWhatsAppUpdate({ ...message, status }, receipt)).toMatchObject({ status: 'DELIVERED', deliveredAt: at, failureReason: null, deliveryErrorCode: null, deliveryFailureKind: null });
  });
  it('read implies delivery and an earlier delayed delivery refines delivery time', () => {
    expect(deriveWhatsAppUpdate(message, { ...receipt, outcome: 'READ' })).toMatchObject({ status: 'DELIVERED', deliveredAt: at, readAt: at });
    const earlier = new Date(at.getTime() - 1000);
    expect(deriveWhatsAppUpdate({ ...message, status: 'DELIVERED', deliveredAt: at, readAt: at }, { ...receipt, occurredAt: earlier })).toMatchObject({ deliveredAt: earlier, readAt: at });
  });
  it.each(['SENT', 'FAILED'] as const)('never lets %s downgrade delivery/read evidence', (outcome) => {
    expect(deriveWhatsAppUpdate({ ...message, status: 'DELIVERED', deliveredAt: at, readAt: at }, { ...receipt, outcome })).toEqual({});
  });
  it('records a normalized failure and rejects older failure and later sent downgrades', () => {
    expect(deriveWhatsAppUpdate(message, { ...receipt, outcome: 'FAILED', errorCode: 131026 })).toMatchObject({ status: 'FAILED', deliveryFailureKind: 'AMBIGUOUS', deliveryErrorCode: 131026 });
    expect(deriveWhatsAppUpdate({ ...message, providerStatusAt: at }, { ...receipt, outcome: 'FAILED', occurredAt: new Date(at.getTime() - 1) })).toEqual({});
    expect(deriveWhatsAppUpdate({ ...message, status: 'FAILED' }, { ...receipt, outcome: 'SENT' })).toEqual({});
  });
  it.each([190, 131005, 131031, 131042, 131051, 132001])('classifies %s as configuration, never an unsubscribe', (code) => {
    expect(classifyWhatsAppCode(code)).toBe('CONFIGURATION');
  });
  it.each([131026, 131049, 131050, 130403])('classifies %s as ambiguous or restricted delivery without global suppression', (code) => {
    expect(classifyWhatsAppCode(code)).toBe('AMBIGUOUS');
  });
  it.each([130429, 131048, 131000, 131016])('classifies %s as transient', (code) => {
    expect(classifyWhatsAppCode(code)).toBe('TRANSIENT');
  });
  it('preserves unknown provider codes as unknown', () => { expect(classifyWhatsAppCode(999999)).toBe('UNKNOWN'); });
});
