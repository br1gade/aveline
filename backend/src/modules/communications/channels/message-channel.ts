import { MessageChannel } from '@prisma/client';

export interface OutboundMessage {
  toAddress: string;
  subject?: string;
  body: string;
  locale: string;
}

export interface DeliveryResult {
  providerRef?: string;
  /** Some providers confirm delivery synchronously; most only accept. */
  isDelivered: boolean;
}

/**
 * One transport. Modelled on the payment gateway port for the same reason:
 * the differences between providers are credentials and wire format, not
 * behaviour, so the service above never branches on channel.
 */
export interface MessageTransport {
  readonly channel: MessageChannel;
  send(message: OutboundMessage): Promise<DeliveryResult>;
}
