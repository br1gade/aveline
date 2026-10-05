import { ConfigService } from '@nestjs/config';
import { MessageChannel } from '@prisma/client';
import { ConsoleTransport } from './console.transport';
import { SmtpTransport } from './smtp.transport';
import { TelegramTransport } from './telegram.transport';
import { WhatsAppTransport } from './whatsapp.transport';
import { buildTransports, deliverableChannels, smtpSettingsFrom } from './transport-registry';

/** A ConfigService over a plain object. */
const configOf = (values: Record<string, string>) =>
  ({ get: (key: string) => values[key] }) as unknown as ConfigService;

describe('smtpSettingsFrom', () => {
  it('reads a full configuration', () => {
    const settings = smtpSettingsFrom(
      configOf({
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_PORT: '587',
        SMTP_USER: 'hello@aveline.am',
        SMTP_PASSWORD: 'app-password',
        MAIL_FROM: 'Aveline <hello@aveline.am>',
      }),
    );

    expect(settings).toEqual({
      host: 'smtp.gmail.com',
      port: 587,
      isSecure: false,
      user: 'hello@aveline.am',
      password: 'app-password',
      from: 'Aveline <hello@aveline.am>',
    });
  });

  /**
   * Both are required. A sender with no from-address is rejected by every
   * provider, so accepting one would turn a configuration mistake into a run
   * of delivery failures that look like the recipients' fault.
   */
  it.each<{ label: string; values: Record<string, string> }>([
    { label: 'no host', values: { MAIL_FROM: 'a@b.c' } },
    { label: 'no from-address', values: { SMTP_HOST: 'smtp.test' } },
    { label: 'neither', values: {} },
    { label: 'an empty host', values: { SMTP_HOST: '', MAIL_FROM: 'a@b.c' } },
  ])('returns null for $label', ({ values }) => {
    expect(smtpSettingsFrom(configOf(values))).toBeNull();
  });

  it('defaults to the submission port', () => {
    expect(smtpSettingsFrom(configOf({ SMTP_HOST: 'smtp.test', MAIL_FROM: 'a@b.c' }))?.port).toBe(
      587,
    );
  });

  // Implicit TLS on 465, STARTTLS elsewhere: inferring it from the port
  // removes the commonest mail-configuration mistake.
  it.each([
    { port: '465', isSecure: true },
    { port: '587', isSecure: false },
    { port: '1025', isSecure: false },
  ])('infers secure=$isSecure from port $port', ({ port, isSecure }) => {
    expect(
      smtpSettingsFrom(configOf({ SMTP_HOST: 'smtp.test', MAIL_FROM: 'a@b.c', SMTP_PORT: port }))
        ?.isSecure,
    ).toBe(isSecure);
  });

  it('lets SMTP_SECURE override the inference', () => {
    expect(
      smtpSettingsFrom(
        configOf({
          SMTP_HOST: 'smtp.test',
          MAIL_FROM: 'a@b.c',
          SMTP_PORT: '2525',
          SMTP_SECURE: 'true',
        }),
      )?.isSecure,
    ).toBe(true);
  });

  it.each(['0', '70000', 'not-a-port'])('refuses port %s at startup', (port) => {
    expect(() =>
      smtpSettingsFrom(configOf({ SMTP_HOST: 'smtp.test', MAIL_FROM: 'a@b.c', SMTP_PORT: port })),
    ).toThrow(/SMTP_PORT/);
  });
});

describe('buildTransports', () => {
  it('gives every channel a transport', () => {
    const transports = buildTransports(configOf({}));

    for (const channel of Object.values(MessageChannel)) {
      expect(transports.get(channel)).toBeDefined();
    }
  });

  it('uses SMTP for email once it is configured', () => {
    const transports = buildTransports(
      configOf({ SMTP_HOST: 'smtp.test', MAIL_FROM: 'a@b.c', SMTP_PORT: '1025' }),
    );

    expect(transports.get(MessageChannel.EMAIL)).toBeInstanceOf(SmtpTransport);
  });

  it('falls back to the console in development, rather than refusing to run', () => {
    const transports = buildTransports(configOf({ NODE_ENV: 'development' }));

    expect(transports.get(MessageChannel.EMAIL)).toBeInstanceOf(ConsoleTransport);
  });

  /**
   * The guard that matters. A console transport in production writes every
   * invitation and password reset to a log file, which looks exactly like
   * success from the outside — so it must be a boot failure, not a warning.
   */
  it('refuses to boot in production with no mail transport', () => {
    expect(() => buildTransports(configOf({ NODE_ENV: 'production' }))).toThrow(/SMTP_HOST/);
  });

  it('boots in production once SMTP is configured', () => {
    expect(() =>
      buildTransports(
        configOf({ NODE_ENV: 'production', SMTP_HOST: 'smtp.test', MAIL_FROM: 'a@b.c' }),
      ),
    ).not.toThrow();
  });

  // The other channels have no implementation yet; recording them beats
  // dropping them.
  it.each([MessageChannel.SMS, MessageChannel.TELEGRAM, MessageChannel.WHATSAPP])(
    'still logs %s to the console',
    (channel) => {
      const transports = buildTransports(configOf({ SMTP_HOST: 'smtp.test', MAIL_FROM: 'a@b.c' }));

      expect(transports.get(channel)).toBeInstanceOf(ConsoleTransport);
    },
  );

  it('uses the Bot API for Telegram once a token is configured', () => {
    const transports = buildTransports(configOf({ TELEGRAM_BOT_TOKEN: 'bot-token' }));

    expect(transports.get(MessageChannel.TELEGRAM)).toBeInstanceOf(TelegramTransport);
  });

  it('uses the Cloud API for WhatsApp once both halves are configured', () => {
    const transports = buildTransports(
      configOf({ WHATSAPP_PHONE_NUMBER_ID: '123', WHATSAPP_ACCESS_TOKEN: 'tok' }),
    );

    expect(transports.get(MessageChannel.WHATSAPP)).toBeInstanceOf(WhatsAppTransport);
  });

  /**
   * One half of a WhatsApp configuration is a mistake that would surface as a
   * run of authentication failures against real guests.
   */
  it.each<{ label: string; values: Record<string, string> }>([
    { label: 'only the phone number id', values: { WHATSAPP_PHONE_NUMBER_ID: '123' } },
    { label: 'only the access token', values: { WHATSAPP_ACCESS_TOKEN: 'tok' } },
  ])('leaves WhatsApp on the console with $label', ({ values }) => {
    const transports = buildTransports(configOf(values));

    expect(transports.get(MessageChannel.WHATSAPP)).toBeInstanceOf(ConsoleTransport);
  });
});

describe('deliverableChannels', () => {
  /**
   * The senders read this so they never choose a channel whose transport is
   * only the console — which would tell a host their guest had been written
   * to when nothing left the building.
   */
  it('reports only what is configured', () => {
    expect(
      deliverableChannels(
        configOf({ SMTP_HOST: 'smtp.test', MAIL_FROM: 'a@b.c', TELEGRAM_BOT_TOKEN: 'tok' }),
      ),
    ).toEqual([MessageChannel.EMAIL, MessageChannel.TELEGRAM]);
  });

  it('reports all three when all three are configured', () => {
    expect(
      deliverableChannels(
        configOf({
          SMTP_HOST: 'smtp.test',
          MAIL_FROM: 'a@b.c',
          TELEGRAM_BOT_TOKEN: 'tok',
          WHATSAPP_PHONE_NUMBER_ID: '123',
          WHATSAPP_ACCESS_TOKEN: 'tok',
        }),
      ),
    ).toHaveLength(3);
  });

  // A product that can plan no sends at all is harder to work on than one
  // that plans them to the console.
  it('falls back to email when nothing is configured', () => {
    expect(deliverableChannels(configOf({}))).toEqual([MessageChannel.EMAIL]);
  });

});