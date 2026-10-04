import { Injectable, Logger } from '@nestjs/common';
import { MessageChannel } from '@prisma/client';
import { DeliveryResult, MessageTransport, OutboundMessage } from './message-channel';

/**
 * Writes messages to the log instead of sending them.
 *
 * Registered for any channel that has no credentials configured, so the whole
 * send pipeline — templating, queueing, dispatch, status — is exercisable in
 * development and in tests without a provider account, and without silently
 * dropping messages.
 */
@Injectable()
export class ConsoleTransport implements MessageTransport {
  private readonly logger = new Logger(ConsoleTransport.name);
  private readonly sent: OutboundMessage[] = [];

  constructor(readonly channel: MessageChannel) {}

  send(message: OutboundMessage): Promise<DeliveryResult> {
    this.sent.push(message);
    this.logger.log(
      `[${this.channel}] → ${message.toAddress} (${message.locale}): ${
        message.subject ? `${message.subject} — ` : ''
      }${message.body.slice(0, 120)}`,
    );
    return Promise.resolve({ providerRef: `console-${this.sent.length}`, isDelivered: true });
  }

  /** Test hook: what this transport was asked to send. */
  outbox(): readonly OutboundMessage[] {
    return this.sent;
  }
}
