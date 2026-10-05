import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MessageChannel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { MessageTransport } from './channels/message-channel';
import { buildTransports } from './channels/transport-registry';
import { CommunicationsService } from './communications.service';
import { GuestChannelsService } from './guest-channels.service';
import { SuppressionService } from './suppression.service';
import { TelegramWebhookController } from './telegram-webhook.controller';

export const MESSAGE_TRANSPORTS = Symbol('MESSAGE_TRANSPORTS');

@Global()
@Module({
  controllers: [TelegramWebhookController],
  providers: [
    {
      provide: MESSAGE_TRANSPORTS,
      inject: [ConfigService],
      useFactory: buildTransports,
    },
    SuppressionService,
    GuestChannelsService,
    {
      provide: CommunicationsService,
      inject: [PrismaService, MESSAGE_TRANSPORTS, SuppressionService],
      useFactory: (
        prisma: PrismaService,
        transports: Map<MessageChannel, MessageTransport>,
        suppressions: SuppressionService,
      ) => new CommunicationsService(prisma, transports, suppressions),
    },
  ],
  exports: [CommunicationsService, SuppressionService, GuestChannelsService],
})
export class CommunicationsModule {}
