import { createHmac } from 'node:crypto';
import { verifyWhatsAppSignature, verifyWhatsAppChallenge } from './whatsapp-auth';

const secret = 'synthetic-app-secret';
const body = Buffer.from('{ "entry": [] }');
const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

describe('Meta webhook authentication', () => {
  it('authenticates exact bytes without a fabricated timestamp header', async () => {
    await expect(verifyWhatsAppSignature(body, signature, secret)).resolves.toBeUndefined();
    await expect(verifyWhatsAppSignature(Buffer.from('{"entry":[]}'), signature, secret)).rejects.toThrow('signature');
  });
  it.each([undefined, '', 'sha256=bad', 'sha1=' + 'a'.repeat(64), 'sha256=' + 'a'.repeat(64)])('rejects invalid signature %s', async (value) => {
    await expect(verifyWhatsAppSignature(body, value, secret)).rejects.toThrow('signature');
  });
  it('fails closed when no secret or raw body exists', async () => {
    await expect(verifyWhatsAppSignature(body, signature, undefined)).rejects.toThrow('configured');
    await expect(verifyWhatsAppSignature(undefined, signature, secret)).rejects.toThrow('body');
    await expect(verifyWhatsAppSignature(Buffer.alloc(3 * 1024 * 1024 + 1), signature, secret)).rejects.toThrow('body');
  });
  it('preserves arbitrary challenge bytes as plain text and rejects unbounded values', () => {
    const query = { 'hub.mode': 'subscribe', 'hub.verify_token': secret, 'hub.challenge': 'opaque+challenge=' };
    expect(verifyWhatsAppChallenge(query, secret)).toBe('opaque+challenge=');
    expect(() => verifyWhatsAppChallenge({ ...query, 'hub.challenge': 'x'.repeat(257) }, secret)).toThrow('challenge');
  });
  it('echoes the bounded challenge only for the configured subscription token', () => {
    expect(verifyWhatsAppChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': secret, 'hub.challenge': '001234' }, secret)).toBe('001234');
    expect(() => verifyWhatsAppChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': '1' }, secret)).toThrow();
    expect(() => verifyWhatsAppChallenge({ 'hub.mode': 'other', 'hub.verify_token': secret, 'hub.challenge': '1' }, secret)).toThrow();
    expect(() => verifyWhatsAppChallenge({ 'hub.mode': 'subscribe', 'hub.verify_token': secret, 'hub.challenge': ['1'] }, secret)).toThrow();
  });
});
