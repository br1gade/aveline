import { Body, Controller, NotFoundException, Post, UnauthorizedException, Headers } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { allowsDevelopmentShortcuts } from '../../common/environment';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { MessageChannel, Prisma, SuppressionReason } from '@prisma/client';
import { Public } from '../../infra/auth/actor';
import { PrismaService } from '../../prisma/prisma.service';
import { GuestChannelsService } from './guest-channels.service';
import { SuppressionService } from './suppression.service';

/** What Telegram posts to us, as much of it as we read. */
interface TelegramUpdate {
  message?: {
    chat?: { id?: number; type?: string };
    text?: string;
  };
  my_chat_member?: {
    chat?: { id?: number; type?: string };
    new_chat_member?: { status?: string };
  };
}

@ApiTags('webhooks')
@Controller('webhooks/telegram')
export class TelegramWebhookController {
  private readonly bot: string;
  private readonly secret: string | undefined;
  private readonly isOpenWithoutSecret: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly guestChannels: GuestChannelsService,
    private readonly suppressions: SuppressionService,
    config: ConfigService,
  ) {
    this.secret = config.get<string>('TELEGRAM_WEBHOOK_SECRET');
    this.bot = config.get<string>('TELEGRAM_BOT_USERNAME') ?? '';
    this.isOpenWithoutSecret = allowsDevelopmentShortcuts(config.get<string>('NODE_ENV') ?? process.env.NODE_ENV);
  }

  /** The authenticated private-chat webhook receives a Telegram-only opt-in code. */
  @Public()
  @Post()
  @ApiExcludeEndpoint()
  async receive(
    @Body() update: TelegramUpdate,
    @Headers('x-telegram-bot-api-secret-token') secretHeader?: string,
  ) {
    this.assertFromTelegram(secretHeader);
    try { await this.apply(readUpdate(update)); }
    catch (error) {
      // A rotated or closed invitation is indistinguishable from an unknown code.
      if (!(error instanceof NotFoundException)) throw error;
    }

    return { ok: true };
  }

  private async apply(update: ReadUpdate): Promise<void> {
    const { chatId, startToken, hasLeft, hasReturned } = update;
    if (!chatId || (!startToken && !hasLeft && !hasReturned)) return;

    await this.prisma.$transaction(async (tx) => {
      // A block, unblock and link for the same chat must observe each other.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`telegram:chat:${chatId}`}, 0))`;
      if (hasLeft) return this.handleBlocked(tx, chatId);

      const didOptIn = startToken && await this.guestChannels.redeemTelegramOptIn(tx, { code: startToken, bot: this.bot, chatId });
      if (hasReturned || didOptIn) await this.suppressions.liftAfterOptIn(MessageChannel.TELEGRAM, chatId, tx);
    });
  }

  private async handleBlocked(tx: Prisma.TransactionClient, chatId: string): Promise<void> {
    await tx.guestChannel.deleteMany({ where: { channel: MessageChannel.TELEGRAM, address: chatId } });
    await this.suppressions.suppress({
      organizationId: null,
      channel: MessageChannel.TELEGRAM,
      address: chatId,
      reason: SuppressionReason.UNSUBSCRIBED,
      notes: 'The guest blocked the bot',
    }, tx);
  }

  /**
   * Refuses an update that did not come from Telegram.
   *
   * Without a secret, only a development or test server listens — for a
   * local bot. Anywhere else the endpoint is closed until one is set: it was
   * open whenever no bot token was configured, production included, and an
   * update can block, unblock or link any chat.
   */
  private assertFromTelegram(secretHeader: string | undefined): void {
    if (!this.secret) {
      if (this.isOpenWithoutSecret) return;
      throw new UnauthorizedException();
    }
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
  if (update?.message) {
    return { chatId: privateChatId(update.message.chat), startToken: startTokenFrom(update.message.text),
      hasLeft: false, hasReturned: false };
  }
  const membership = update?.my_chat_member;
  const status = membership?.new_chat_member?.status ?? '';
  return { chatId: privateChatId(membership?.chat), startToken: null,
    hasLeft: LEFT_STATUSES.has(status), hasReturned: status === 'member' };
}

function privateChatId(chat: { id?: number; type?: string } | undefined): string | null {
  if (chat?.type !== 'private' || typeof chat.id !== 'number' || !Number.isSafeInteger(chat.id) || chat.id <= 0) return null;
  return String(chat.id);
}

/** `/start <token>`, which is how Telegram delivers a deep-link payload. */
export function startTokenFrom(text: string | undefined): string | null {
  if (typeof text !== 'string') return null;

  const match = /^\/start(?:@\w+)?\s+(\S+)$/.exec(text.trim());
  return match ? match[1] : null;
}
