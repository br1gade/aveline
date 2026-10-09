import { Logger } from '@nestjs/common';
import { MessageChannel } from '@prisma/client';
import { DeliveryResult, MessageTransport, OutboundMessage } from './message-channel';

export interface WhatsAppSettings {
  /** The WhatsApp Business phone number id from Meta, not the number itself. */
  phoneNumberId: string;
  accessToken: string;
  apiBaseUrl?: string;
  apiVersion?: string;
}

interface WhatsAppReply {
  messages?: { id?: string }[];
  error?: { message?: string; code?: number; type?: string };
}

/**
 * WhatsApp, over Meta's Cloud API.
 *
 * Two things make this unlike email and Telegram:
 *
 * 1. **It can reach someone cold** — which is why it exists here at all, since
 *    Telegram cannot and email ends up in spam from a new domain.
 * 2. **It refuses free text.** A business-initiated message must be a template
 *    registered with Meta in advance, identified by name, with its variables
 *    supplied as positional parameters. So the rendered body we store and show
 *    the host is not what travels: the template name and its parameters are.
 *    A message with no `template` is a configuration mistake and fails loudly
 *    rather than being sent as text Meta will reject.
 *
 * Every delivered template is billed, which is why `channel-preference.ts`
 * ranks it below a channel the guest opted into.
 */
export class WhatsAppTransport implements MessageTransport {
  readonly channel = MessageChannel.WHATSAPP;

  private readonly logger = new Logger(WhatsAppTransport.name);
  private readonly endpoint: string;

  constructor(
    private readonly settings: WhatsAppSettings,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const base = settings.apiBaseUrl ?? 'https://graph.facebook.com';
    const version = settings.apiVersion ?? 'v21.0';
    this.endpoint = `${base}/${version}/${settings.phoneNumberId}/messages`;
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    if (!message.template) {
      // Not a provider failure, so it is not thrown as one: this is our
      // template configuration missing a providerTemplate, and retrying it
      // would never help.
      throw Object.assign(
        new Error(
          'WhatsApp only sends templates registered with Meta. Set providerTemplate and ' +
            'providerParams on this MessageTemplate.',
        ),
        { code: 'ESECURITY' },
      );
    }

    const response = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.settings.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: toE164(message.toAddress),
        type: 'template',
        template: {
          name: message.template.providerTemplate,
          language: { code: message.locale },
          components: [
            {
              type: 'body',
              parameters: message.template.params.map((text) => ({ type: 'text', text })),
            },
          ],
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const reply = (await response.json()) as WhatsAppReply;
    if (reply.error || !response.ok) throw whatsAppError(reply, response.status);

    const providerRef = reply.messages?.[0]?.id;
    this.logger.log(`whatsapp → ${message.toAddress} (${providerRef ?? '?'})`);

    // Accepted, not delivered. Meta reports delivery and read receipts later,
    // through a webhook we do not consume yet.
    return { providerRef, isDelivered: false };
  }
}

/**
 * Meta wants a number with no `+` and no separators.
 *
 * Normalised here rather than at the call site so a number stored the way a
 * host typed it — `+374 10 000000` — still sends.
 */
export function toE164(address: string): string {
  return address.replace(/[^\d]/g, '');
}

/**
 * Maps a Cloud API error onto the SMTP-shaped range the dispatcher's
 * classifier already understands, so one classifier serves every channel.
 *
 * The distinction worth getting right: 131026 means the number is not on
 * WhatsApp, which no amount of retrying changes and which should suppress
 * that address. 131048 is a per-number throughput limit — temporary, and
 * suppressing on it would lose a guest over our own rate.
 */
function whatsAppError(reply: WhatsAppReply, httpStatus: number): Error {
  const code = reply.error?.code ?? httpStatus;
  const description = reply.error?.message ?? 'WhatsApp rejected the message';

  if (AUTHENTICATION_CODES.has(code)) {
    return Object.assign(new Error(description), { code: 'EAUTH', response: `${code} ${description}` });
  }
  // A template problem is ours to fix. Read as the guest's bounce, it put
  // their number on the platform-wide suppression list, where no host can
  // lift it.
  if (TEMPLATE_CODES.has(code)) {
    return Object.assign(new Error(description), { code: 'ECONFIG', response: `${code} ${description}` });
  }

  return Object.assign(new Error(description), {
    responseCode: UNDELIVERABLE_CODES.has(code) ? 550 : 451,
    response: `${code} ${description}`,
    whatsAppErrorCode: code,
  });
}

/** Our credentials or our account, never the recipient's problem. */
const AUTHENTICATION_CODES = new Set([
  0, // AuthException
  3, // insufficient permission
  10, // permission denied
  190, // access token expired
  200, // permission error
]);

/** The recipient cannot receive it, now or ever. */
const UNDELIVERABLE_CODES = new Set([
  131026, // message undeliverable — not a WhatsApp user
  131049, // blocked by the user's privacy settings
  131051, // unsupported message type for this recipient
]);

/** Our message template is wrong or unavailable: nothing about the recipient. */
const TEMPLATE_CODES = new Set([
  132000, // template parameter count mismatch
  132001, // template does not exist
  132005, // translated text too long
  132007, // template format policy violated
  132012, // template parameter format mismatch
  132015, // template is paused for quality reasons
  132016, // template is disabled
]);
