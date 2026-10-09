import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { GuestChannelsService } from './guest-channels.service';
import { SuppressionService } from './suppression.service';
import { TelegramWebhookController } from './telegram-webhook.controller';

/**
 * B56: with no secret configured the webhook accepted anyone, production
 * included — so a stranger could block, unblock or link any chat.
 */
describe('TelegramWebhookController', () => {
  const webhookWith = (values: Record<string, string>) =>
    new TelegramWebhookController(
      {} as PrismaService,
      {} as GuestChannelsService,
      {} as SuppressionService,
      { get: (key: string) => values[key] } as unknown as ConfigService,
    );

  // An update with no chat in it is ignored once it is let in.
  const nothing = {};

  it.each(['production', 'staging'])('refuses every update in %s when no secret is set', async (nodeEnv) => {
    await expect(webhookWith({ NODE_ENV: nodeEnv }).receive(nothing)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it.each(['development', 'test'])('accepts updates in %s without a secret, for a local bot', async (nodeEnv) => {
    await expect(webhookWith({ NODE_ENV: nodeEnv }).receive(nothing)).resolves.toEqual({ ok: true });
  });

  it('requires the secret once one is set', async () => {
    const webhook = webhookWith({ NODE_ENV: 'production', TELEGRAM_WEBHOOK_SECRET: 'shh' });

    await expect(webhook.receive(nothing, 'wrong')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(webhook.receive(nothing, 'shh')).resolves.toEqual({ ok: true });
  });
});
