import { BlockType, PrismaClient } from '@prisma/client';
import { MESSAGE_COPY } from '../../../src/seed/message-copy';

/**
 * Platform data a fresh deployment gets from `seed-production`: the classic
 * template a host picks from and Aveline's own message copy. A customer
 * cannot create either, so a journey that starts from registration needs them.
 */
export async function seedPlatformDefaults(prisma: PrismaClient): Promise<void> {
  await prisma.designTemplate.upsert({
    where: { key: 'classic' },
    update: {},
    create: {
      key: 'classic',
      name: 'Classic',
      allowedFonts: ['Noto Serif Armenian', 'Inter'],
      palettes: [{ name: 'ivory-gold', colors: ['#fffaf0', '#b8860b'] }],
      supportedBlocks: [BlockType.HERO, BlockType.VENUE, BlockType.NOTES, BlockType.RSVP],
      blockVariants: { HERO: ['full-bleed', 'split'], RSVP: ['split', 'stacked'] },
      defaultTheme: { bodyFont: 'Noto Serif Armenian', palette: 'ivory-gold' },
    },
  });
  await prisma.messageTemplate.createMany({
    data: MESSAGE_COPY.map((template) => ({ ...template, organizationId: null })),
  });
}

/** The personal link a sent message carries, as an API path under the invitation. */
export function guestPathIn(body: string): string {
  const match = /\/invitations\/([^/\s]+)\/g\/([^/\s]+)/.exec(body);
  if (!match) throw new Error(`No personal link in message: ${body}`);
  return `/invitations/${match[1]}/g/${match[2]}`;
}

/** The host's headcount as a vendor is meant to get it: everything but the named breakdown. */
export function withoutHouseholdNames(headcount: Record<string, unknown>): Record<string, unknown> {
  const { byHousehold: _named, ...counts } = headcount;
  return counts;
}
