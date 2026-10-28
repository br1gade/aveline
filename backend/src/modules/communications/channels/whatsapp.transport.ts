import { classifyWhatsAppCode } from '../whatsapp/whatsapp-outcome';
import { MessageChannel } from '@prisma/client';
import { DeliveryResult, MessageTransport, OutboundMessage } from './message-channel';

export interface WhatsAppSettings {
  /** The WhatsApp Business phone number id from Meta, not the number itself. */
  phoneNumberId: string;
  accountId: string;
  accessToken: string;
  apiBaseUrl?: string;
  apiVersion: string;
}

interface WhatsAppReply {
  messages?: { id?: string }[];
  error?: { message?: string; code?: number; type?: string };
}

/** Sends business-initiated, approved templates; guest consent is a setup gate. */
export class WhatsAppTransport implements MessageTransport {
  readonly channel = MessageChannel.WHATSAPP;

  private readonly endpoint: string;

  constructor(
    private readonly settings: WhatsAppSettings,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const base = settings.apiBaseUrl ?? 'https://graph.facebook.com';
    const version = settings.apiVersion;
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
    if (typeof providerRef !== 'string' || !providerRef || providerRef.length > 512) throw Object.assign(new Error('WhatsApp acceptance omitted its message reference'), { code: 'ECONFIG' });
    return { providerRef, providerAccountId: this.settings.accountId, providerSenderId: this.settings.phoneNumberId, isDelivered: false };
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

/** Provider descriptions may contain contacts; persist/log only normalized codes. */
function whatsAppError(reply: WhatsAppReply, httpStatus: number): Error {
  const providerCode = reply.error?.code;
  const code = typeof providerCode === 'number' && Number.isSafeInteger(providerCode) && providerCode >= 0 ? providerCode : httpStatus;
  const description = `WhatsApp rejected the message (${code})`;
  if ([130403, 131050].includes(code)) return Object.assign(new Error(description), { code: 'EREJECTED' });
  if (AUTHENTICATION_CODES.has(code)) return Object.assign(new Error(description), { code: 'EAUTH' });
  if (classifyWhatsAppCode(code) === 'CONFIGURATION') return Object.assign(new Error(description), { code: 'ECONFIG' });
  // 131026 has several causes. 131049 is ecosystem throttling, not a block.
  // Neither establishes a permanent refusal suitable for global suppression.
  return Object.assign(new Error(description), { responseCode: 451, whatsAppErrorCode: code, retryAfterMs: code === 131049 ? 24 * 60 * 60 * 1000 : undefined });
}
const AUTHENTICATION_CODES = new Set([0, 3, 10, 190, 200, 131005]);
