import { Body, Controller, Logger, Post, UnauthorizedException, Headers } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { MessageChannel, SuppressionReason } from '@prisma/client';
import { Public } from '../../infra/auth/actor';
import { PrismaService } from '../../prisma/prisma.service';
import { GuestChannelsService } from './guest-channels.service';
import { SuppressionService } from './suppression.service';

/** What Telegram posts to us, as much of it as we read. */
interface TelegramUpdate {
  message?: {
    chat?: { id?: number };
    text?: string;
  };
  my_chat_member?: {
    chat?: { id?: number };
    new_chat_member?: { status?: string };
  };
}

@ApiTags('webhooks')
@Controller('webhooks/telegram')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);
  private readonly secret: string | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly guestChannels: GuestChannelsService,
    private readonly suppressions: SuppressionService,
    config: ConfigService,
  ) {
    this.secret = config.get<string>('TELEGRAM_WEBHOOK_SECRET');
  }

  /**
   * Where a guest's Telegram opt-in arrives.
   *
   * The flow this completes: the emailed invitation carries a deep link,
   * `t.me/<bot>?start=<guestToken>`. Tapping it opens the bot and sends us
   * `/start <guestToken>`, which is the only moment we learn their chat id —
   * a bot cannot message anyone who has not done this.
   *
   * Public, because Telegram calls it. Authenticated by a secret token that
   * Telegram echoes in a header, which is the mechanism the Bot API provides:
   * without it anyone who guessed a guest token could register their own chat
   * id against that guest and receive their invitation.
   *
   * Always answers 200. Telegram retries anything else, and a retry storm
   * caused by our own parsing error is worse than a dropped update.
   */
  @Public()
  @Post()
  @ApiExcludeEndpoint()
  async receive(
    @Body() update: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secretHeader?: string,
  ) {
    this.assertFromTelegram(secretHeader);
    await this.apply(readUpdate(update));

    return { ok: true };
  }

  private async apply(update: ReadUpdate): Promise<void> {
    if (update.chatId === null) return;

    if (update.hasLeft) {
      await this.handleBlocked(update.chatId);
      return;
    }
    // Unblocking is the guest's own act, so it ends the opt-out it began.
    if (update.hasReturned) await this.suppressions.liftAfterOptIn(MessageChannel.TELEGRAM, update.chatId);
    if (update.startToken) await this.handleStart(update.startToken, update.chatId);
  }

  /**
   * Links the chat to the guest whose token was in the deep link.
   *
   * The token is the guest's existing capability token — the same one already
   * in their invitation URL — so this adds no new secret to leak. An unknown
   * token is ignored silently: telling a stranger whether a token is real is
   * the one thing this endpoint must not do.
   */
  private async handleStart(token: string, chatId: string): Promise<void> {
    const guest = await this.prisma.guest.findUnique({
      where: { token },
      select: { id: true, anonymizedAt: true },
    });

    if (!guest || guest.anonymizedAt !== null) {
      this.logger.warn('telegram /start with an unrecognised token');
      return;
    }

    await this.guestChannels.recordOptIn(guest.id, MessageChannel.TELEGRAM, chatId);
    // A guest who blocked the bot and starts it again has opted back in; the
    // suppression from the block would otherwise outlive their own decision.
    await this.suppressions.liftAfterOptIn(MessageChannel.TELEGRAM, chatId);
  }

  /**
   * A guest blocking the bot is an unsubscribe, and is treated as one.
   *
   * Both halves matter: the suppression stops us writing to that chat id, and
   * forgetting the address stops the sender choosing Telegram at all, so the
   * guest falls back to email instead of silently receiving nothing.
   */
  private async handleBlocked(chatId: string): Promise<void> {
    const channel = await this.prisma.guestChannel.findFirst({
      where: { channel: MessageChannel.TELEGRAM, address: chatId },
      select: { guestId: true },
    });

    await this.suppressions.suppress({
      organizationId: null,
      channel: MessageChannel.TELEGRAM,
      address: chatId,
      reason: SuppressionReason.UNSUBSCRIBED,
      notes: 'The guest blocked the bot',
    });

    if (channel) await this.guestChannels.forget(channel.guestId, MessageChannel.TELEGRAM);
    this.logger.log(`telegram chat ${chatId} blocked the bot`);
  }

  /**
   * Refuses an update that did not come from Telegram.
   *
   * When no secret is configured — development, before a bot exists — the
   * check is skipped, because a webhook nobody can reach needs no guard. In
   * production the secret is required by `validateEnv`, so this cannot be
   * skipped where it matters.
   */
  private assertFromTelegram(secretHeader: string | undefined): void {
    if (!this.secret) return;
    if (secretHeader !== this.secret) throw new UnauthorizedException();
  }
}

/**
 * The three things we read out of an update, so the handler above reads as the
 * decision it makes rather than as a walk through Telegram's payload shape.
 */
interface ReadUpdate {
  chatId: string | null;
  startToken: string | null;
  hasLeft: boolean;
  hasReturned: boolean;
}

/** Telegram reports both of these when a user removes a bot. */
const LEFT_STATUSES = new Set(['kicked', 'left']);

function readUpdate(update: TelegramUpdate): ReadUpdate {
  const chatId = chatIdFrom(update);
  const status = update.my_chat_member?.new_chat_member?.status ?? '';

  return {
    chatId,
    startToken: startTokenFrom(update.message?.text),
    hasLeft: LEFT_STATUSES.has(status),
    hasReturned: status === 'member',
  };
}

function chatIdFrom(update: TelegramUpdate): string | null {
  const chatId = update.message?.chat?.id ?? update.my_chat_member?.chat?.id;
  return chatId === undefined ? null : String(chatId);
}

/** `/start <token>`, which is how Telegram delivers a deep-link payload. */
export function startTokenFrom(text: string | undefined): string | null {
  if (!text) return null;

  const match = /^\/start(?:@\w+)?\s+(\S+)$/.exec(text.trim());
  return match ? match[1] : null;
}
