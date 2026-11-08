import { MessageChannel } from '@prisma/client';
import { invitationEmailFooter } from './invitation-email-footer';

const invitation = { channel: MessageChannel.EMAIL, templateKey: 'invitation.send', locale: 'en' };

describe('invitation email footer', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['hy', 'Անձնական տվյալների'],
    ['en', 'Make a request'],
    ['ru', 'Подать запрос'],
    ['fr-CA', 'Faire une demande'],
  ])('uses a localized public link for %s', (locale, wording) => {
    jest.replaceProperty(process, 'env', { ...process.env, PUBLIC_APP_URL: 'https://client.example', PUBLIC_SITE_URL: '' });
    expect(invitationEmailFooter({ ...invitation, locale })).toContain(wording);
    expect(invitationEmailFooter({ ...invitation, locale })).toContain('https://client.example/privacy-request');
  });

  it('includes the separate website only when configured as a web URL', () => {
    jest.replaceProperty(process, 'env', { ...process.env, PUBLIC_SITE_URL: 'https://site.example' });
    expect(invitationEmailFooter(invitation)).toContain('Aveline — https://site.example/');
    process.env.PUBLIC_SITE_URL = 'javascript:alert(1)';
    expect(invitationEmailFooter(invitation)).not.toContain('javascript:');
  });

  it('scopes the footer to invitation email', () => {
    expect(invitationEmailFooter({ ...invitation, templateKey: 'rsvp.reminder' })).toBe('');
    expect(invitationEmailFooter({ ...invitation, channel: MessageChannel.TELEGRAM })).toBe('');
  });
});
