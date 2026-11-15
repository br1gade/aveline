import { isGenuineUnsubscribe, unsubscribeUrlFor } from './email-unsubscribe';

/**
 * The link in a host's guest mail that stops that host's mail to the address
 * (audit F-10). It is a capability: it names the message, and the signature
 * is what keeps anyone else from unsubscribing a guest they know the
 * message id of.
 */
describe('email unsubscribe links', () => {
  const invitation = { id: 'msg_1', channel: 'EMAIL' as const, templateKey: 'invitation.send', organizationId: 'org_1' };
  const secret = 'a-test-secret-of-enough-length-000';
  const parts = (url: string) => new URL(url).pathname.split('/').slice(-2) as [string, string];

  it.each(['invitation.send', 'rsvp.reminder', 'event.details-changed', 'thankyou.send'])('offers one on %s', (templateKey) => {
    expect(unsubscribeUrlFor({ ...invitation, templateKey }, 'https://aveline.test', secret)).toMatch(/^https:\/\/aveline\.test\/api\/v1\/email-unsubscribe\/msg_1\/[\w-]{43}$/);
  });

  it.each([
    ['account mail, which nobody can opt out of', { templateKey: 'account.password-reset', organizationId: null }],
    ['a ticket, which the buyer asked for', { templateKey: 'ticket.issued' }],
    ['a message that is not email', { channel: 'TELEGRAM' as const }],
  ])('offers none on %s', (_case, change) => {
    expect(unsubscribeUrlFor({ ...invitation, ...change }, 'https://aveline.test', secret)).toBeUndefined();
  });

  it('accepts its own link and nothing altered', () => {
    const [messageId, signature] = parts(unsubscribeUrlFor(invitation, 'https://aveline.test', secret) ?? '');
    expect(isGenuineUnsubscribe(messageId, signature, secret)).toBe(true);
    expect(isGenuineUnsubscribe('msg_2', signature, secret)).toBe(false);
    expect(isGenuineUnsubscribe(messageId, `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`, secret)).toBe(false);
    expect(isGenuineUnsubscribe(messageId, 'short', secret)).toBe(false);
    expect(isGenuineUnsubscribe(messageId, signature, 'another-secret-of-enough-length-00')).toBe(false);
  });
});
