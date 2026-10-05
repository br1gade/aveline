import { MessageChannel } from '@prisma/client';

export interface OutboundMessage {
  toAddress: string;
  subject?: string;
  body: string;
  locale: string;
  /**
   * The structured content behind the rendered body.
   *
   * Email and Telegram send `body` as it is. WhatsApp will not accept free
   * text at all — it only sends templates registered with Meta in advance —
   * so it needs the template's own name and its variables in the order the
   * provider expects them as positional parameters.
   *
   * Carried alongside the rendered text rather than replacing it, because the
   * rendered text is what we store on the Message and show the host as "what
   * was sent". A provider template is how it travelled, not what it said.
   */
  template?: {
    /** The provider's registered template name. */
    providerTemplate: string;
    /** Positional parameters, already in the provider's expected order. */
    params: string[];
  };
}

export interface DeliveryResult {
  providerRef?: string;
  /** Some providers confirm delivery synchronously; most only accept. */
  isDelivered: boolean;
}

/**
 * One transport.
 *
 * Modelled on the payment gateway port for the same reason: the differences
 * between providers are credentials and wire format, not behaviour, so the
 * service above never branches on channel.
 *
 * A transport throws on failure rather than returning one. The dispatcher
 * classifies the error — retry, bounce, or our own misconfiguration — and that
 * decision needs the provider's own response, not a swallowed one.
 */
export interface MessageTransport {
  readonly channel: MessageChannel;
  send(message: OutboundMessage): Promise<DeliveryResult>;
}
