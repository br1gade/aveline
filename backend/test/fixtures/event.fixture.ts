import { BlockType, PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';

export interface SeededEvent {
  eventId: string;
  slug: string;
  primaryGuestToken: string;
  householdId: string;
  seatsAllotted: number;
}

/**
 * Builds the smallest event that still exercises the real relationships:
 * one organization, one published invitation, one household with spare seats.
 * Tests vary `seatsAllotted` to probe the capacity boundary.
 */
export async function seedEvent(
  prisma: PrismaClient,
  options: { seatsAllotted?: number; isPublished?: boolean } = {},
): Promise<SeededEvent> {
  const seatsAllotted = options.seatsAllotted ?? 2;
  const isPublished = options.isPublished ?? true;
  const slug = `e2e-${randomUUID().slice(0, 8)}`;

  const template = await prisma.designTemplate.upsert({
    where: { key: 'test-template' },
    update: {},
    create: {
      key: 'test-template',
      name: 'Test',
      allowedFonts: ['Inter'],
      supportedBlocks: [BlockType.HERO, BlockType.RSVP],
    },
  });

  const organization = await prisma.organization.create({
    data: { name: 'Fixture Org', kind: 'HOST' },
  });

  const event = await prisma.event.create({
    data: {
      organizationId: organization.id,
      type: 'WEDDING',
      title: 'Fixture Wedding',
      hostsLabel: 'A & B',
      startsAt: new Date(Date.now() + 86_400_000 * 30),
      locales: ['hy', 'en'],
      defaultLocale: 'hy',
      sideALabel: 'A',
      sideBLabel: 'B',
      status: 'PUBLISHED',
      venues: {
        create: { role: 'RECEPTION', name: 'Fixture Hall', address: '1 Test St', capacity: 50 },
      },
    },
  });

  await prisma.invitation.create({
    data: {
      eventId: event.id,
      slug,
      templateId: template.id,
      status: isPublished ? 'PUBLISHED' : 'DRAFT',
      blocks: {
        create: [
          { type: BlockType.HERO, sortOrder: 0, content: { hy: { title: 'Բարև' }, en: { title: 'Hello' } } },
          { type: BlockType.RSVP, sortOrder: 1 },
        ],
      },
    },
  });

  const household = await prisma.household.create({
    data: { eventId: event.id, name: 'Fixture Household', seatsAllotted },
  });

  const guest = await prisma.guest.create({
    data: {
      eventId: event.id,
      householdId: household.id,
      firstName: 'Primary',
      lastName: 'Guest',
      token: randomUUID().replace(/-/g, '').slice(0, 12),
      attribution: 'SIDE_A',
      isPrimary: true,
      rsvp: { create: { status: 'PENDING' } },
    },
  });

  return {
    eventId: event.id,
    slug,
    primaryGuestToken: guest.token,
    householdId: household.id,
    seatsAllotted,
  };
}
