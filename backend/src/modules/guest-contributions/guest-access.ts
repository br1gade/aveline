import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isReadableByGuests } from '../invitations/publishing';

export async function readGuestAccess(tx: Prisma.TransactionClient, slug: string, token: string) {
  const guest = await tx.guest.findFirst({ where: { token, anonymizedAt: null, event: { invitation: { slug } } },
    select: { id: true, eventId: true, householdId: true, firstName: true, lastName: true, locale: true,
      event: { select: { locales: true, defaultLocale: true, invitation: { select: { id: true, status: true, expiresAt: true } } } } } });
  const invitation = guest?.event.invitation;
  if (!guest || !invitation || !isReadableByGuests(invitation.status)) throw new NotFoundException('Invitation link not recognised');
  if (invitation.expiresAt && invitation.expiresAt <= new Date()) throw new NotFoundException('Invitation link not recognised');
  return guest;
}
export type GuestAccess = Awaited<ReturnType<typeof readGuestAccess>>;

export async function lockGuestAccess(tx: Prisma.TransactionClient, slug: string, token: string) {
  const before = await readGuestAccess(tx, slug, token);
  // Match RSVP/erasure ordering. Re-read the capability after waiting for locks.
  await tx.$queryRaw`SELECT id FROM events WHERE id = ${before.eventId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM households WHERE id = ${before.householdId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM guests WHERE "householdId" = ${before.householdId} ORDER BY id FOR UPDATE`;
  const current = await readGuestAccess(tx, slug, token);
  if (current.householdId !== before.householdId) throw new NotFoundException('Invitation changed; reload it');
  return current;
}
