import { isDeepStrictEqual } from 'node:util';
import type { Prisma, PrismaClient } from '@prisma/client';
import { MESSAGE_COPY } from './message-copy';

/**
 * Writes Aveline's own templates (`organizationId` null) from MESSAGE_COPY.
 * `fill` adds only what is missing, so production never reverts copy an
 * operator edited there; `refresh` also rewrites changed copy, for a
 * development database that should show the current wording. An
 * organization's own templates are never read or written here.
 *
 * Not an upsert: Prisma cannot address a compound unique whose component is
 * null. The partial index from migration 20261004170000 keeps one per key and
 * channel.
 */
export async function syncPlatformCopy(prisma: PrismaClient, mode: 'fill' | 'refresh'): Promise<{ created: number; updated: number }> {
  const stored = await prisma.messageTemplate.findMany({ where: { organizationId: null } });
  const byKey = new Map(stored.map((template) => [`${template.key}:${template.channel}`, template]));
  let created = 0;
  let updated = 0;
  for (const copy of MESSAGE_COPY) {
    // A text or Telegram message has no subject; the column stores that as {}.
    const subject = (copy.subject ?? {}) as Prisma.InputJsonValue;
    const existing = byKey.get(`${copy.key}:${copy.channel}`);
    if (!existing) {
      await prisma.messageTemplate.create({ data: { ...copy, organizationId: null } });
      created += 1;
    } else if (mode === 'refresh' && (!isDeepStrictEqual(existing.subject, subject) || !isDeepStrictEqual(existing.body, copy.body))) {
      await prisma.messageTemplate.update({ where: { id: existing.id }, data: { subject, body: copy.body } });
      updated += 1;
    }
  }
  return { created, updated };
}
