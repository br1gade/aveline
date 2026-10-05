import { Logger } from '@nestjs/common';
import { MessageChannel } from '@prisma/client';
import { DeliveryResult, MessageTransport, OutboundMessage } from './message-channel';

export interface TelegramSettings {
  botToken: string;
  /** Overridable so tests and a local proxy can point elsewhere. */
  apiBaseUrl?: string;
}

/** The shape of a Bot API reply, as much of it as we read. */
interface TelegramReply {
  ok: boolean;
  result?: { message_id?: number };
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

/**
 * Telegram, over the Bot API.
 *
 * The constraint that shapes everything: **a bot cannot message someone who
 * has not started a conversation with it.** There is no way to write to a
 * phone number or an @username cold. So Telegram is never the first contact —
 * a guest arrives by tapping a deep link in their emailed invitation, the
 * webhook records their chat id, and reminders and day-of updates then go
 * here. Free, and read sooner than email.
 *
 * `toAddress` is a numeric chat id, not a username, because that is what the
 * opt-in gives us and what the API addresses.
 */
export class TelegramTransport implements MessageTransport {
  readonly channel = MessageChannel.TELEGRAM;

  private readonly logger = new Logger(TelegramTransport.name);
  private readonly apiBaseUrl: string;

  constructor(
    private readonly settings: TelegramSettings,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.apiBaseUrl = settings.apiBaseUrl ?? 'https://api.telegram.org';
  }

  async send(message: OutboundMessage): Promise<DeliveryResult> {
    const response = await this.fetchImpl(
      `${this.apiBaseUrl}/bot${this.settings.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: message.toAddress,
          text: message.body,
          // Plain text on purpose. Template copy is authored by hosts and
          // rendered with guest-supplied values; parsing it as HTML or
          // Markdown would let a stray bracket break the send, or worse,
          // inject formatting into every guest's message.
          disable_web_page_preview: false,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );

    const reply = (await response.json()) as TelegramReply;
    if (!reply.ok) throw telegramError(reply, response.status);

    this.logger.log(`telegram → ${message.toAddress} (${reply.result?.message_id ?? '?'})`);

    // The Bot API accepting a message means it was delivered to Telegram's
    // servers and will reach the device; there is no later bounce.
    return { providerRef: String(reply.result?.message_id ?? ''), isDelivered: true };
  }
}

/**
 * Translates a Bot API failure into something the dispatcher can classify.
 *
 * The mapping that matters: 403 means the guest blocked the bot — permanent,
 * and the only honest response is to stop writing to them there. 429 is rate
 * limiting, which is temporary however emphatic it sounds.
 */
function telegramError(reply: TelegramReply, httpStatus: number): Error {
  const code = reply.error_code ?? httpStatus;
  const description = reply.description ?? 'Telegram rejected the message';

  return Object.assign(new Error(description), {
    // Mapped onto the SMTP-shaped range the classifier already understands, so
    // one classifier serves every channel: 5xx is permanent, 4xx is not.
    responseCode: isPermanent(code) ? 550 : 451,
    response: `${code} ${description}`,
    telegramErrorCode: code,
  });
}

/**
 * 400 is included deliberately: the Bot API returns it for "chat not found",
 * which is what a deleted account or a wrong chat id looks like, and retrying
 * that forever is pointless.
 */
function isPermanent(code: number): boolean {
  return code === 400 || code === 403;
}
