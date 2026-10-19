import { WHATSAPP_SETTINGS, validateWhatsAppConfig } from '../../../common/whatsapp-config';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { allowsDevelopmentShortcuts } from '../../../common/environment';
import { MessageChannel } from '@prisma/client';
import { ConsoleTransport } from './console.transport';
import { MessageTransport } from './message-channel';
import { SmsProvider, SmsSettings, SmsTransport } from './sms.transport';
import { SmtpSettings, SmtpTransport } from './smtp.transport';
import { TelegramSettings, TelegramTransport } from './telegram.transport';
import { WhatsAppSettings, WhatsAppTransport } from './whatsapp.transport';

const logger = new Logger('TransportRegistry');

/**
 * The SMS providers Aveline can send through, by the name `SMS_PROVIDER`
 * takes. Empty until one is chosen (decided 9 October 2026: build the channel
 * provider-neutral, choose later); adding one is a class implementing
 * `SmsProvider` and a row here.
 */
export type SmsProviderFactory = (config: ConfigService) => SmsProvider;
export const SMS_PROVIDERS: Readonly<Record<string, SmsProviderFactory>> = {};

/**
 * Production requires real SMTP and enables other channels only once their
 * sender configuration is complete. Development can exercise console
 * transports; planners still prefer channels that can actually deliver.
 */
export function buildTransports(
  config: ConfigService,
  smsProviders: Readonly<Record<string, SmsProviderFactory>> = SMS_PROVIDERS,
): Map<MessageChannel, MessageTransport> {
  const smtp = smtpSettingsFrom(config);
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  if (isProduction && !smtp) {
    throw new Error(
      'No mail transport configured. Set SMTP_HOST and MAIL_FROM, or do not run with ' +
        'NODE_ENV=production — otherwise every email is written to the log and silently lost.',
    );
  }

  const transports = new Map<MessageChannel, MessageTransport>();
  // The console stands in for unconfigured channels only where nobody is
  // waiting for the message. In production it reported messages as
  // delivered that went nowhere; there, a channel with no transport fails
  // the message visibly instead — and the planners never choose it.
  if (allowsDevelopmentShortcuts(config.get<string>('NODE_ENV'))) {
    for (const channel of Object.values(MessageChannel)) {
      transports.set(channel, new ConsoleTransport(channel));
    }
  }

  if (smtp) {
    transports.set(MessageChannel.EMAIL, new SmtpTransport(smtp));
    logger.log(`email over SMTP via ${smtp.host}:${smtp.port} as ${smtp.from}`);
  } else {
    logger.warn('no SMTP configured — email is written to the log and not delivered');
  }

  const telegram = telegramSettingsFrom(config);
  if (telegram) {
    transports.set(MessageChannel.TELEGRAM, new TelegramTransport(telegram));
    logger.log('telegram over the Bot API');
  }

  const whatsapp = whatsAppSettingsFrom(config);
  if (whatsapp) {
    transports.set(MessageChannel.WHATSAPP, new WhatsAppTransport(whatsapp));
    logger.log(`whatsapp over the Cloud API as ${whatsapp.phoneNumberId}`);
  }

  const sms = smsSettingsFrom(config, smsProviders);
  if (sms) {
    transports.set(MessageChannel.SMS, new SmsTransport(sms));
    logger.log(`sms through ${sms.provider.name}`);
  }

  return transports;
}

/**
 * Which channels can actually reach a guest.
 *
 * Read by the senders so they never choose a channel whose transport is only
 * the console: queueing a WhatsApp message with no credentials would tell a
 * host their guest had been written to when nothing had left the building.
 */
export function deliverableChannels(config: ConfigService): MessageChannel[] {
  const configured: MessageChannel[] = [];

  if (smtpSettingsFrom(config)) configured.push(MessageChannel.EMAIL);
  if (telegramSettingsFrom(config)) configured.push(MessageChannel.TELEGRAM);
  if (whatsAppSettingsFrom(config)) configured.push(MessageChannel.WHATSAPP);
  if (smsProviderName(config)) configured.push(MessageChannel.SMS);

  // In development nothing may be configured, and a product that can plan no
  // sends at all is harder to work on than one that plans them to the console.
  return configured.length > 0 ? configured : [MessageChannel.EMAIL];
}

export function telegramSettingsFrom(config: ConfigService): TelegramSettings | null {
  const botToken = config.get<string>('TELEGRAM_BOT_TOKEN');
  return botToken ? { botToken } : null;
}

/** Sending stays inert until the same account can also authenticate receipts. */
export function whatsAppSettingsFrom(config: ConfigService): WhatsAppSettings | null {
  const values = Object.fromEntries(WHATSAPP_SETTINGS.map((key) => [key, config.get<string>(key)]));
  validateWhatsAppConfig({ ...values, NODE_ENV: config.get<string>('NODE_ENV') });
  if (WHATSAPP_SETTINGS.some((key) => !values[key])) return null;
  return { phoneNumberId: values.WHATSAPP_PHONE_NUMBER_ID!, accessToken: values.WHATSAPP_ACCESS_TOKEN!, accountId: values.WHATSAPP_ACCOUNT_ID!, apiVersion: values.WHATSAPP_API_VERSION! };
}

/**
 * Settings, or null when email is not configured.
 *
 * Both the host and the from-address are required: a sender with no address is
 * rejected by every provider, so accepting one would turn a configuration
 * mistake into a run of delivery failures.
 */
export function smtpSettingsFrom(config: ConfigService): SmtpSettings | null {
  const host = config.get<string>('SMTP_HOST');
  const from = config.get<string>('MAIL_FROM');
  if (!host || !from) return null;

  const port = Number(config.get<string>('SMTP_PORT') ?? 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`SMTP_PORT must be a valid port number, got "${config.get('SMTP_PORT')}"`);
  }

  return {
    host,
    port,
    // Port 465 is implicit TLS; 587 and 1025 upgrade with STARTTLS. Defaulting
    // from the port rather than requiring a flag removes the commonest
    // mail-configuration mistake.
    isSecure: config.get<string>('SMTP_SECURE') === 'true' || port === 465,
    user: config.get<string>('SMTP_USER'),
    password: config.get<string>('SMTP_PASSWORD'),
    from,
  };
}

function smsProviderName(config: ConfigService): string | null {
  return config.get<string>('SMS_PROVIDER')?.trim() || null;
}

/**
 * SMS, when `SMS_PROVIDER` names a provider Aveline has. Naming one it does
 * not have refuses to boot: a typo would otherwise leave every text unsent
 * while the setting looked right.
 */
export function smsSettingsFrom(
  config: ConfigService,
  providers: Readonly<Record<string, SmsProviderFactory>> = SMS_PROVIDERS,
): SmsSettings | null {
  const name = smsProviderName(config);
  if (!name) return null;

  const factory = providers[name];
  if (!factory) {
    const known = Object.keys(providers);
    throw new Error(
      `SMS_PROVIDER "${name}" is not one Aveline can send through; ` +
        (known.length > 0 ? `use one of ${known.join(', ')}` : 'none is built yet — leave it unset'),
    );
  }
  return { provider: factory(config), defaultCountryCode: config.get<string>('SMS_DEFAULT_COUNTRY_CODE') ?? '374' };
}
