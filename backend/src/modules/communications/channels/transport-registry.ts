import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageChannel } from '@prisma/client';
import { ConsoleTransport } from './console.transport';
import { MessageTransport } from './message-channel';
import { SmtpSettings, SmtpTransport } from './smtp.transport';
import { TelegramSettings, TelegramTransport } from './telegram.transport';
import { WhatsAppSettings, WhatsAppTransport } from './whatsapp.transport';

const logger = new Logger('TransportRegistry');

/**
 * Which transport serves each channel.
 *
 * Email uses SMTP when it is configured and the console otherwise, so the
 * whole pipeline stays exercisable without a provider account. The other
 * channels have no implementation yet and fall back to the console, which
 * records them rather than dropping them.
 *
 * **In production the fallback is a startup error, not a fallback.** A console
 * transport in production means invitations, password resets and ticket
 * confirmations are written to a log file and nobody receives them — a failure
 * that looks exactly like success from the outside. Refusing to boot is the
 * only version of that which gets noticed.
 */
export function buildTransports(config: ConfigService): Map<MessageChannel, MessageTransport> {
  const smtp = smtpSettingsFrom(config);
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  if (isProduction && !smtp) {
    throw new Error(
      'No mail transport configured. Set SMTP_HOST and MAIL_FROM, or do not run with ' +
        'NODE_ENV=production — otherwise every email is written to the log and silently lost.',
    );
  }

  const transports = new Map<MessageChannel, MessageTransport>();
  for (const channel of Object.values(MessageChannel)) {
    transports.set(channel, new ConsoleTransport(channel));
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

  // In development nothing may be configured, and a product that can plan no
  // sends at all is harder to work on than one that plans them to the console.
  return configured.length > 0 ? configured : [MessageChannel.EMAIL];
}

export function telegramSettingsFrom(config: ConfigService): TelegramSettings | null {
  const botToken = config.get<string>('TELEGRAM_BOT_TOKEN');
  return botToken ? { botToken } : null;
}

/**
 * WhatsApp needs both halves: the phone number id identifies which sender,
 * the token authorises it. One without the other is a configuration mistake
 * that would surface as a run of authentication failures.
 */
export function whatsAppSettingsFrom(config: ConfigService): WhatsAppSettings | null {
  const phoneNumberId = config.get<string>('WHATSAPP_PHONE_NUMBER_ID');
  const accessToken = config.get<string>('WHATSAPP_ACCESS_TOKEN');
  if (!phoneNumberId || !accessToken) return null;

  return { phoneNumberId, accessToken };
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
