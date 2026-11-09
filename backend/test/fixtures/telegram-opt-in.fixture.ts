import { PrismaClient } from '@prisma/client';
import { createTelegramOptIn, INVITATION_EMAIL_TEMPLATE } from '../../src/modules/communications/telegram-opt-in';

export const TEST_TELEGRAM_BOT = 'AvelineBot';

export function telegramStartCode(body: string): string {
  const code = /\?start=(tg1_[A-Za-z0-9_-]{32})/u.exec(body)?.[1];
  if (!code) throw new Error('Expected a Telegram opt-in code in the invitation email');
  return code;
}

export function telegramStartUpdate(code: string, id: number) {
  return { message: { chat: { id, type: 'private' }, text: `/start ${code}` } };
}

export async function issueTelegramOptIn(
  prisma: PrismaClient,
  guestToken: string,
  bot = TEST_TELEGRAM_BOT,
) {
  const guest = await prisma.guest.findUniqueOrThrow({
    where: { token: guestToken },
    include: { event: { include: { invitation: true } } },
  });
  const optIn = createTelegramOptIn(bot, guest.event.invitation!, guestToken);
  const message = await prisma.message.create({
    data: {
      ...optIn.grant, guestId: guest.id, eventId: guest.eventId, organizationId: guest.event.organizationId,
      channel: 'EMAIL', templateKey: INVITATION_EMAIL_TEMPLATE, toAddress: 'test@example.test', body: optIn.url, status: 'SENT',
    },
  });
  return { code: telegramStartCode(optIn.url), messageId: message.id };
}
