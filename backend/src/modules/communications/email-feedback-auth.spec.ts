import { createHmac } from 'node:crypto';
import { verifyEmailFeedback } from './email-feedback-auth';

describe('provider-neutral feedback authentication', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');
  const timestamp = String(now / 1000);
  const body = Buffer.from('{"messageId":"synthetic"}');
  const secret = 'a-long-random-feedback-signing-secret';
  const signature = createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');

  it('accepts only the signed raw bytes', () => {
    expect(() => verifyEmailFeedback(body, { timestamp, signature }, secret, now)).not.toThrow();
    expect(() => verifyEmailFeedback(Buffer.from('{}'), { timestamp, signature }, secret, now)).toThrow(/Invalid feedback signature/);
  });
  it.each([undefined, '', 'bad', '0'.repeat(64)])('refuses signature %p without comparing unequal buffers', (value) => {
    expect(() => verifyEmailFeedback(body, { timestamp, signature: value }, secret, now)).toThrow(/feedback/);
  });
  it('refuses unconfigured ingestion', () => {
    expect(() => verifyEmailFeedback(body, { timestamp, signature }, undefined, now)).toThrow(/not configured/);
  });
  it.each([-301000, 301000])('refuses replay or future timestamps with offset %p', (offset) => {
    const time = String((now + offset) / 1000);
    const signed = createHmac('sha256', secret).update(`${time}.`).update(body).digest('hex');
    expect(() => verifyEmailFeedback(body, { timestamp: time, signature: signed }, secret, now)).toThrow(/timestamp/);
  });
});
