import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ConsoleTransport } from './channels/console.transport';
import { MessageTransport } from './channels/message-channel';
import { CommunicationsService } from './communications.service';

export const MESSAGE_TRANSPORTS = Symbol('MESSAGE_TRANSPORTS');

/**
 * Every channel gets a transport. Where no provider is configured the console
 * transport stands in, so the pipeline is always exercisable and a missing
 * provider is visible in the log rather than a silently dropped message.
 *
 * Real transports (SMTP, an SMS gateway, the Telegram Bot API, WhatsApp Cloud)
 * plug in here and implement the same two-method port.
 */
function buildTransports(_config: ConfigService): Map<MessageChannel, MessageTransport> {
  const transports = new Map<MessageChannel, MessageTransport>();
  for (const channel of Object.values(MessageChannel)) {
    transports.set(channel, new ConsoleTransport(channel));
  }
  return transports;
}

@Global()
@Module({
  providers: [
    {
      provide: MESSAGE_TRANSPORTS,
      inject: [ConfigService],
      useFactory: buildTransports,
    },
    {
      provide: CommunicationsService,
      inject: [PrismaService, MESSAGE_TRANSPORTS],
      useFactory: (prisma: PrismaService, transports: Map<MessageChannel, MessageTransport>) =>
        new CommunicationsService(prisma, transports),
    },
  ],
  exports: [CommunicationsService],
})
export class CommunicationsModule {}
