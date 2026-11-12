import { MessageChannel } from '@prisma/client';
import { addressFingerprint, isFingerprint, normalizeAddress, storedForms } from './address-form';

describe('address forms', () => {
  it('hashes an email the same way whatever its capitals', () => {
    expect(addressFingerprint(MessageChannel.EMAIL, ' Ani@Example.AM ')).toBe(
      addressFingerprint(MessageChannel.EMAIL, 'ani@example.am'),
    );
  });

  it('gives nothing of the address back', () => {
    const fingerprint = addressFingerprint(MessageChannel.EMAIL, 'ani@example.am');
    expect(isFingerprint(fingerprint)).toBe(true);
    expect(fingerprint).not.toContain('ani');
  });

  it('offers both stored forms, plain first', () => {
    const [plain, hashed] = storedForms(MessageChannel.SMS, ' +37491000000 ');
    expect(plain).toBe('+37491000000');
    expect(hashed).toBe(addressFingerprint(MessageChannel.SMS, '+37491000000'));
    expect(isFingerprint(plain)).toBe(false);
  });

  // FR-99(d): a suppression typed "+374 91 000000" never matched a guest's "+37491000000".
  it.each([MessageChannel.SMS, MessageChannel.WHATSAPP])('writes an international %s number one way however it is spaced', (channel) => {
    for (const typed of ['+374 91 000000', '+374-91-000-000', '(+374) 91 000 000', '0037491000000', ' +37491000000 ']) {
      expect(normalizeAddress(channel, typed)).toBe('+37491000000');
    }
  });

  it('keeps a local number local rather than guessing its country', () => {
    expect(normalizeAddress(MessageChannel.SMS, '091 000-000')).toBe('091000000');
  });

  it('leaves a Telegram handle as typed', () => {
    expect(normalizeAddress(MessageChannel.TELEGRAM, ' some-handle ')).toBe('some-handle');
  });
});
