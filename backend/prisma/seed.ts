/**
 * Seeds one realistic wedding so the RSVP slice can be exercised end to end.
 * Run: npm run db:seed
 */
import {
  BlockType,
  Event,
  Organization,
  PrismaClient,
  QuestionType,
  User,
  Venue,
  VenueRole,
} from '@prisma/client';
import { MESSAGE_COPY } from '../src/seed/message-copy';
import { customAlphabet } from 'nanoid';

const prisma = new PrismaClient();
const newGuestToken = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 12);

const DEMO_ORG = 'Demo Hosts';
const EVENT_START = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90);

async function seedTemplate() {
  return prisma.designTemplate.upsert({
    where: { key: 'classic' },
    update: {},
    create: {
      key: 'classic',
      name: 'Classic',
      allowedFonts: ['Noto Serif Armenian', 'Cormorant Garamond', 'Inter'],
      palettes: [
        { key: 'ivory-gold', colors: ['#F3E9DD', '#C9A227', '#2E2A26'] },
        { key: 'sage', colors: ['#EDF1EA', '#7A8B74', '#2E2A26'] },
      ],
      supportedBlocks: [
        BlockType.HERO,
        BlockType.STORY,
        BlockType.COUNTDOWN,
        BlockType.VENUE,
        BlockType.MAP,
        BlockType.TIMELINE,
        BlockType.DRESS_CODE,
        BlockType.RSVP,
        BlockType.CONTACT,
      ],
      // Every block offers the three layouts the design docs name.
      blockVariants: Object.fromEntries(
        ['HERO', 'STORY', 'COUNTDOWN', 'VENUE', 'MAP', 'TIMELINE', 'DRESS_CODE', 'RSVP', 'CONTACT'].map((type) => [
          type,
          ['full-bleed', 'split', 'stacked'],
        ]),
      ),
      defaultTheme: { font: 'Noto Serif Armenian', palette: 'ivory-gold' },
    },
  });
}

/**
 * One org owner plus one Aveline concierge, to exercise both access paths.
 *
 * Upserted rather than created: deleting the demo organization cascades its
 * memberships but not the users themselves, and the concierge never had a
 * membership to begin with. Creating them outright makes a second `db:seed`
 * fail on the unique email.
 */
async function seedUsers(organizationId: string): Promise<User> {
  const owner = await prisma.user.upsert({
    where: { email: 'owner@demo.test' },
    update: { organizationMemberships: { create: { organizationId, role: 'OWNER' } } },
    create: {
      email: 'owner@demo.test',
      name: 'Demo Owner',
      organizationMemberships: { create: { organizationId, role: 'OWNER' } },
    },
  });

  await prisma.user.upsert({
    where: { email: 'concierge@aveline.test' },
    update: {},
    create: { email: 'concierge@aveline.test', name: 'Concierge', platformRole: 'SUPPORT' },
  });

  return owner;
}

async function seedEvent(organization: Organization) {
  return prisma.event.create({
    data: {
      organizationId: organization.id,
      type: 'WEDDING',
      title: 'Anna & Davit',
      hostsLabel: 'Anna & Davit',
      startsAt: EVENT_START,
      timezone: 'Asia/Yerevan',
      locales: ['hy', 'ru', 'en'],
      defaultLocale: 'hy',
      sideALabel: 'Anna',
      sideBLabel: 'Davit',
      status: 'PUBLISHED',
      venues: {
        create: [
          {
            role: VenueRole.CEREMONY,
            name: 'Demo Cathedral',
            address: '1 Demo Square, Yerevan',
            sortOrder: 0,
            arriveAt: new Date(EVENT_START.getTime() - 1000 * 60 * 60 * 4),
          },
          {
            role: VenueRole.RECEPTION,
            name: 'Riverside Hall',
            capacity: 120,
            address: '12 Demo Street, Yerevan',
            sortOrder: 1,
            arriveAt: EVENT_START,
          },
        ],
      },
    },
    include: { venues: true },
  });
}

async function seedTimeline(event: Event, ceremony: Venue, reception: Venue) {
  const at = (hoursFromStart: number) =>
    new Date(EVENT_START.getTime() + hoursFromStart * 60 * 60 * 1000);

  await prisma.timelineEntry.createMany({
    data: [
      {
        eventId: event.id,
        venueId: ceremony.id,
        label: { hy: 'Պսակադրություն', ru: 'Венчание', en: 'Ceremony' },
        occursAt: at(-4),
        sortOrder: 0,
      },
      {
        eventId: event.id,
        venueId: reception.id,
        label: { hy: 'Հյուրերի դիմավորում', ru: 'Встреча гостей', en: 'Guest reception' },
        occursAt: at(-0.5),
        sortOrder: 1,
      },
      {
        eventId: event.id,
        venueId: reception.id,
        label: { hy: 'Հարսանյաց հանդես', ru: 'Банкет', en: 'Dinner' },
        occursAt: at(0),
        sortOrder: 2,
      },
      {
        eventId: event.id,
        venueId: reception.id,
        label: { hy: 'Տորթի կտրում', ru: 'Торт', en: 'Cake cutting' },
        occursAt: at(4),
        sortOrder: 3,
      },
    ],
  });
}

async function seedInvitation(eventId: string, templateId: string) {
  return prisma.invitation.create({
    data: {
      eventId,
      slug: 'anna-davit',
      templateId,
      theme: { palette: 'ivory-gold', font: 'Cormorant Garamond' },
      status: 'PUBLISHED',
      blocks: {
        create: [
          {
            type: BlockType.HERO,
            sortOrder: 0,
            content: { hy: { title: 'Աննա և Դավիթ' }, en: { title: 'Anna & Davit' } },
          },
          {
            type: BlockType.STORY,
            sortOrder: 1,
            content: {
              hy: { body: 'Ուրախ կլինենք Ձեզ հետ կիսել մեր կյանքի այս կարևոր օրը։' },
              en: { body: 'We would be glad to share this important day with you.' },
            },
          },
          { type: BlockType.COUNTDOWN, sortOrder: 2 },
          { type: BlockType.VENUE, sortOrder: 3 },
          { type: BlockType.MAP, sortOrder: 4 },
          { type: BlockType.TIMELINE, sortOrder: 5 },
          {
            type: BlockType.DRESS_CODE,
            sortOrder: 6,
            content: { hy: { body: 'Երեկոյան զգեստներ' }, en: { body: 'Evening wear' } },
            settings: { palette: ['#2E2A26', '#C9A227', '#7A8B74'] },
          },
          { type: BlockType.RSVP, sortOrder: 7 },
          {
            type: BlockType.CONTACT,
            sortOrder: 8,
            content: { en: { organizer: 'Aveline', phone: '+374 00 000000' } },
          },
        ],
      },
      questions: {
        create: [
          {
            type: QuestionType.SINGLE_CHOICE,
            sortOrder: 0,
            prompt: { hy: 'Ինչպե՞ս եք հասնելու', en: 'How will you be arriving?' },
            options: { hy: ['Մեքենայով', 'Տրանսֆերով'], en: ['Own car', 'Shuttle'] },
          },
        ],
      },
    },
  });
}

const HOUSEHOLDS = [
  { name: 'Petrosyan family', seats: 3, first: 'Armen', last: 'Petrosyan', side: 'SIDE_A' },
  { name: 'Sargsyan', seats: 2, first: 'Mariam', last: 'Sargsyan', side: 'SIDE_B' },
  { name: 'Hakobyan', seats: 1, first: 'Tigran', last: 'Hakobyan', side: 'SIDE_B' },
] as const;

async function seedGuests(eventId: string, slug: string): Promise<string[]> {
  const links: string[] = [];

  for (const entry of HOUSEHOLDS) {
    const household = await prisma.household.create({
      data: { eventId, name: entry.name, seatsAllotted: entry.seats },
    });

    const guest = await prisma.guest.create({
      data: {
        eventId,
        householdId: household.id,
        firstName: entry.first,
        lastName: entry.last,
        token: newGuestToken(),
        attribution: entry.side,
        isPrimary: true,
        rsvp: { create: { status: 'PENDING' } },
      },
    });

    links.push(
      `  ${entry.first} ${entry.last} (${entry.seats} seat/s) ` +
        `→ /api/invitations/${slug}/g/${guest.token}`,
    );
  }

  return links;
}

/** A public, ticketed event so the announcement and checkout surfaces are
 *  exercisable alongside the private wedding. */
async function seedPublicEvent(organizationId: string) {
  const startsAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 45);

  const event = await prisma.event.create({
    data: {
      organizationId,
      type: 'CORPORATE',
      title: 'Yerevan Design Summit',
      hostsLabel: 'Aveline',
      startsAt,
      locales: ['hy', 'en'],
      defaultLocale: 'hy',
      visibility: 'PUBLIC',
      status: 'PUBLISHED',
      venues: {
        create: {
          role: VenueRole.RECEPTION,
          name: 'Demo Conference Hall',
          address: '5 Demo Avenue, Yerevan',
          capacity: 300,
        },
      },
      listing: {
        create: {
          slug: 'design-summit',
          headline: { hy: 'Երևանյան դիզայնի գագաթնաժողով', en: 'Yerevan Design Summit' },
          summary: { hy: 'Մեկօրյա համաժողով', en: 'A one-day conference' },
          categories: ['conference'],
          isIndexable: true,
          publishedAt: new Date(),
        },
      },
      ticketTypes: {
        create: [
          {
            name: { hy: 'Ընդհանուր', en: 'General' },
            priceMinor: 15000n,
            quantityTotal: 200,
            maxPerOrder: 6,
            sortOrder: 0,
          },
          {
            name: { hy: 'Ուսանողական', en: 'Student' },
            priceMinor: 7000n,
            quantityTotal: 50,
            maxPerOrder: 2,
            sortOrder: 1,
          },
        ],
      },
    },
  });

  return event;
}

/** Default message copy, so the outbox has something to render. */

async function seedMessageTemplates() {

  // Not an upsert: Prisma cannot address a compound unique whose component is
  // null. The partial index added in 20261004170000 is what guarantees
  // uniqueness here; this only avoids re-inserting on a repeat seed.
  for (const template of MESSAGE_COPY) {
    const existing = await prisma.messageTemplate.findFirst({
      where: { organizationId: null, key: template.key, channel: template.channel },
    });
    if (!existing) await prisma.messageTemplate.create({ data: template });
  }
}

async function main() {
  // Orders first. An order line refuses deletion of the ticket type it points
  // at — deliberately, since a type with sales must never be deleted — and a
  // single cascade from the organization does not promise to remove the lines
  // before the types. So re-seeding failed as soon as the demo event had sold
  // anything. Removing the orders cascades their lines and tickets away first.
  await prisma.ticketOrder.deleteMany({ where: { event: { organization: { name: DEMO_ORG } } } });
  await prisma.organization.deleteMany({ where: { name: DEMO_ORG } });

  const template = await seedTemplate();
  const organization = await prisma.organization.create({
    data: { name: DEMO_ORG, kind: 'HOST' },
  });
  const owner = await seedUsers(organization.id);

  const event = await seedEvent(organization);
  const ceremony = event.venues.find((venue) => venue.role === VenueRole.CEREMONY)!;
  const reception = event.venues.find((venue) => venue.role === VenueRole.RECEPTION)!;

  await seedTimeline(event, ceremony, reception);
  const invitation = await seedInvitation(event.id, template.id);

  await prisma.eventMembership.create({
    data: { userId: owner.id, eventId: event.id, role: 'OWNER' },
  });

  await prisma.table.createMany({
    data: [
      { eventId: event.id, venueId: reception.id, name: 'Table 1', capacity: 10, zone: 'main hall' },
      { eventId: event.id, venueId: reception.id, name: 'Table 2', capacity: 10, zone: 'main hall' },
    ],
  });

  const links = await seedGuests(event.id, invitation.slug);
  const publicEvent = await seedPublicEvent(organization.id);
  await seedMessageTemplates();

  console.log('\nSeeded event:', event.id);
  console.log('Invitation:   /api/invitations/' + invitation.slug);
  console.log('Guest links:\n' + links.join('\n'));
  console.log('\nOperations:   /api/events/' + event.id + '/headcount');
  console.log('Public event: /api/public/events/design-summit  (' + publicEvent.id + ')\n');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
