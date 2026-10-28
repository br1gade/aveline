import { validateWhatsAppConfig } from './whatsapp-config';
const complete = { WHATSAPP_ACCOUNT_ID: '111', WHATSAPP_PHONE_NUMBER_ID: '222', WHATSAPP_ACCESS_TOKEN: 'synthetic', WHATSAPP_API_VERSION: 'v25.0', WHATSAPP_APP_SECRET: 'a'.repeat(32), WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'b'.repeat(32) };
describe('WhatsApp deployment configuration', () => {
  it('allows an unconfigured channel but requires send/receipt configuration together in production', () => {
    expect(() => validateWhatsAppConfig({ NODE_ENV: 'production' })).not.toThrow();
    expect(() => validateWhatsAppConfig({ NODE_ENV: 'production', ...complete })).not.toThrow();
    for (const key of Object.keys(complete)) {
      expect(() => validateWhatsAppConfig({ NODE_ENV: 'production', ...complete, [key]: '' })).toThrow(key);
    }
  });
  it.each([{ WHATSAPP_API_VERSION: 'latest' }, { WHATSAPP_ACCOUNT_ID: '../escape' }, { WHATSAPP_PHONE_NUMBER_ID: '22/path' }, { WHATSAPP_APP_SECRET: 'short' }, { WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'short' }])('rejects malformed configured values', (values) => {
    expect(() => validateWhatsAppConfig(values)).toThrow('WHATSAPP');
  });
});
