import { createHash, randomBytes } from 'node:crypto';
import { MessageStatus, Prisma } from '@prisma/client';

const OPT_IN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OPT_IN_CODE = /^tg1_[A-Za-z0-9_-]{32}$/u;
const TELEGRAM_START_LINK = /https:\/\/t\.me\/[A-Za-z0-9_]+\?start=[A-Za-z0-9_-]+/gu;

export const INVITATION_EMAIL_TEMPLATE = 'invitation.send';
export const REDEEMABLE_EMAIL_STATUSES: MessageStatus[] = ['SENDING', 'SENT', 'DELIVERED'];

export type TelegramOptInGrant = Pick<Prisma.MessageCreateManyInput,
  'telegramOptInDigest' | 'telegramOptInBinding' | 'telegramOptInExpiresAt'>;

export function createTelegramOptIn(
  bot: string,
  invitation: { id: string; expiresAt: Date | null },
  guestToken: string,
) {
  // The prefix and base64url payload fit Telegram's private start parameter.
  const code = `tg1_${randomBytes(24).toString('base64url')}`;
  const expiresAt = Math.min(Date.now() + OPT_IN_TTL_MS, invitation.expiresAt?.getTime() ?? Infinity);
  return {
    url: `https://t.me/${bot}?start=${code}`,
    grant: {
      telegramOptInDigest: digest(code),
      telegramOptInBinding: telegramOptInBinding(bot, invitation.id, guestToken),
      telegramOptInExpiresAt: new Date(expiresAt),
    } satisfies TelegramOptInGrant,
  };
}

export function telegramOptInDigest(code: string): string | null {
  return OPT_IN_CODE.test(code) ? digest(code) : null;
}

export function telegramOptInBinding(bot: string, invitationId: string, token: string): string {
  return digest(JSON.stringify([bot.toLowerCase(), invitationId, token]));
}

export function replaceTelegramStartLinks(text: string, replacement: string): string {
  return text.replace(TELEGRAM_START_LINK, replacement);
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
