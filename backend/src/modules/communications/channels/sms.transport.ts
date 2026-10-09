import { MessageChannel } from '@prisma/client';
import { DeliveryResult, MessageTransport, OutboundMessage } from './message-channel';

/**
 * A text-message provider — the one thing that changes between them.
 *
 * Provider-neutral by decision (9 October 2026): the provider is chosen
 * later, so everything that is ours — choosing SMS, normalising the number,
 * classifying failures, the outbox — is built and tested against this port,
 * and adding a provider is one class and one row in `SMS_PROVIDERS`.
 *
 * A provider throws with `responseCode` 5xx for a number that cannot receive
 * a text (suppressed, never retried) and anything else for a failure worth
 * retrying, the same convention the other transports use.
 */
export interface SmsProvider {
  readonly name: string;
  send(toE164: string, text: string): Promise<{ providerRef?: string }>;
}

export interface SmsSettings {
  provider: SmsProvider;
  /** Prefixed to a number written the local way, with a leading 0: 374 for Armenia. */
  defaultCountryCode: string;
}

/**
 * Text messages — for the guest who reads neither email nor a chat app, often
 * the older half of an Armenian guest list. Last in the channel order: every
 * message costs, and anyone with another channel is reached on it.
 */
export class SmsTransport implements MessageTransport {
  readonly channel = MessageChannel.SMS;

  constructor(private readonly settings: SmsSettings) {}

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const to = toE164(message.toAddress, this.settings.defaultCountryCode);
    if (!to) {
      // The number cannot be dialled as written: an address problem, so it is
      // reported as undeliverable — suppressed, and shown to the host to fix.
      throw Object.assign(new Error(`"${message.toAddress}" is not a phone number a text can reach`), {
        responseCode: 550,
      });
    }

    const result = await this.settings.provider.send(to, message.body);
    return { providerRef: result.providerRef, isDelivered: false };
  }
}

/**
 * A phone number as providers want it: +, country code, number.
 *
 * Hosts type numbers the way people write them — "+374 91 000000",
 * "091-000-000", "00374 91 000000". A leading 0 is the local form and takes
 * the default country code; 00 is the international prefix. Anything that is
 * not then 8 to 15 digits is not a number a text can reach.
 */
export function toE164(raw: string, defaultCountryCode: string): string | null {
  const compact = raw.replace(/[\s().-]/g, '');
  let digits: string;
  if (compact.startsWith('+')) digits = compact.slice(1);
  else if (compact.startsWith('00')) digits = compact.slice(2);
  else if (compact.startsWith('0')) digits = `${defaultCountryCode}${compact.slice(1)}`;
  else return null;

  return /^\d{8,15}$/.test(digits) ? `+${digits}` : null;
}
