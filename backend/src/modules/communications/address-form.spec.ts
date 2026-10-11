import { MessageChannel } from '@prisma/client';
import { addressFingerprint, isFingerprint, storedForms } from './address-form';

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
});
