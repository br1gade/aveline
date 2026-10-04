/**
 * Seeds one realistic wedding so the RSVP slice can be exercised end to end.
 * Run: npm run db:seed
 */
import { BlockType, PrismaClient, QuestionType, VenueRole } from '@prisma/client';
import { customAlphabet } from 'nanoid';

const prisma = new PrismaClient();
const token = customAlphabet('23456789abcdefghjkmnpqrstuvwxyz', 12);

async function main() {
  await prisma.organization.deleteMany({ where: { name: 'Demo Hosts' } });

  const org = await prisma.organization.create({
    data: { name: 'Demo Hosts', kind: 'HOST' },
  });

  const startsAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 90);

  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      type: 'WEDDING',
      title: 'Anna & Davit',
      hostsLabel: 'Anna & Davit',
      startsAt,
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
            arriveAt: new Date(startsAt.getTime() - 1000 * 60 * 60 * 4),
          },
          {
            role: VenueRole.RECEPTION,
            name: 'Riverside Hall',
            address: '12 Demo Street, Yerevan',
            sortOrder: 1,
            arriveAt: startsAt,
          },
        ],
      },
    },
    include: { venues: true },
  });

  const ceremony = event.venues.find((v) => v.role === VenueRole.CEREMONY)!;
  const reception = event.venues.find((v) => v.role === VenueRole.RECEPTION)!;

  await prisma.timelineEntry.createMany({
    data: [
      {
        eventId: event.id,
        venueId: ceremony.id,
        label: { hy: 'Պսակադրություն', ru: 'Венчание', en: 'Ceremony' },
        occursAt: new Date(startsAt.getTime() - 1000 * 60 * 60 * 4),
        sortOrder: 0,
      },
      {
        eventId: event.id,
        venueId: reception.id,
        label: { hy: 'Հյուրերի դիմավորում', ru: 'Встреча гостей', en: 'Guest reception' },
        occursAt: new Date(startsAt.getTime() - 1000 * 60 * 30),
        sortOrder: 1,
      },
      {
        eventId: event.id,
        venueId: reception.id,
        label: { hy: 'Հարսանյաց հանդես', ru: 'Банкет', en: 'Dinner' },
        occursAt: startsAt,
        sortOrder: 2,
      },
      {
        eventId: event.id,
        venueId: reception.id,
        label: { hy: 'Տորթի կտրում', ru: 'Торт', en: 'Cake cutting' },
        occursAt: new Date(startsAt.getTime() + 1000 * 60 * 60 * 4),
        sortOrder: 3,
      },
    ],
  });

  const invitation = await prisma.invitation.create({
    data: {
      eventId: event.id,
      slug: 'anna-davit',
      template: 'classic',
      theme: { palette: ['#F3E9DD', '#C9A227', '#2E2A26'], font: 'serif' },
      status: 'PUBLISHED',
      blocks: {
        create: [
          { type: BlockType.HERO, sortOrder: 0, content: { hy: { title: 'Անna & Դավիթ' }, en: { title: 'Anna & Davit' } } },
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
          { type: BlockType.CONTACT, sortOrder: 8, content: { en: { organizer: 'Aveline', phone: '+374 00 000000' } } },
        ],
      },
      questions: {
        create: [
          {
            type: QuestionType.SINGLE_CHOICE,
            sortOrder: 0,
            required: false,
            prompt: { hy: 'Ինչպե՞ս եք հասնելու', en: 'How will you be arriving?' },
            options: { hy: ['Մեքենայով', 'Տրանսֆերով'], en: ['Own car', 'Shuttle'] },
          },
        ],
      },
    },
  });

  // Three households, five guests.
  const seedHouseholds = [
    { name: 'Petrosyan family', seats: 3, primary: 'Armen', last: 'Petrosyan', side: 'SIDE_A' as const },
    { name: 'Sargsyan', seats: 2, primary: 'Mariam', last: 'Sargsyan', side: 'SIDE_B' as const },
    { name: 'Hakobyan', seats: 1, primary: 'Tigran', last: 'Hakobyan', side: 'SIDE_B' as const },
  ];

  const links: string[] = [];
  for (const h of seedHouseholds) {
    const household = await prisma.household.create({
      data: { eventId: event.id, name: h.name, seatsAllotted: h.seats },
    });
    const guest = await prisma.guest.create({
      data: {
        eventId: event.id,
        householdId: household.id,
        firstName: h.primary,
        lastName: h.last,
        token: token(),
        attribution: h.side,
        isPrimary: true,
        rsvp: { create: { status: 'PENDING' } },
      },
    });
    links.push(`  ${h.primary} ${h.last} (${h.seats} seat/s) → /api/invitations/${invitation.slug}/g/${guest.token}`);
  }

  await prisma.table.createMany({
    data: [
      { eventId: event.id, name: 'Table 1', capacity: 10 },
      { eventId: event.id, name: 'Table 2', capacity: 10 },
    ],
  });

  console.log('\nSeeded event:', event.id);
  console.log('Invitation:   /api/invitations/' + invitation.slug);
  console.log('Guest links:');
  console.log(links.join('\n'));
  console.log('\nOperations:   /api/events/' + event.id + '/headcount\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
