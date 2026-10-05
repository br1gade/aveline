import { ConfigService } from '@nestjs/config';
import { MessageChannel, PrismaClient } from '@prisma/client';
import { MessageTransport } from '../../src/modules/communications/channels/message-channel';
import { SmtpTransport } from '../../src/modules/communications/channels/smtp.transport';
import { CommunicationsService } from '../../src/modules/communications/communications.service';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import { InvitationSenderService } from '../../src/modules/invitations/sending/invitation-sender.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const MAILPIT_API = process.env.MAILPIT_API ?? 'http://localhost:8025';

interface MailpitMessage {
  ID: string;
  Subject: string;
  To: { Address: string }[];
}

async function inbox(): Promise<MailpitMessage[]> {
  const response = await fetch(`${MAILPIT_API}/api/v1/messages?limit=50`);
  return ((await response.json()) as { messages: MailpitMessage[] }).messages;
}

async function textOf(id: string): Promise<string> {
  const response = await fetch(`${MAILPIT_API}/api/v1/message/${id}`);
  return ((await response.json()) as { Text: string }).Text;
}

/**
 * The product's core loop, end to end: a guest list becomes real email.
 *
 * Every step of this exists and is tested in isolation. This is the one test
 * that proves they connect — a host presses send and a specific person
 * receives a working, personalised link. If this passes, the thing the market
 * does by hand is automated; if it fails, nothing else in the product matters.
 */
describe('invitation loop (integration)', () => {
  let prisma: PrismaClient;
  let sender: InvitationSenderService;
  let communications: CommunicationsService;

  beforeAll(() => {
    prisma = testPrisma();
    const suppressions = new SuppressionService(prisma as unknown as PrismaService);
    const transports = new Map<MessageChannel, MessageTransport>([
      [
        MessageChannel.EMAIL,
        new SmtpTransport({
          host: 'localhost',
          port: 1025,
          isSecure: false,
          from: 'Aveline <hello@aveline.test>',
        }),
      ],
    ]);
    communications = new CommunicationsService(
      prisma as unknown as PrismaService,
      transports,
      suppressions,
    );
    sender = new InvitationSenderService(
      prisma as unknown as PrismaService,
      communications,
      { get: () => 'https://aveline.test' } as unknown as ConfigService,
    );
  });

  beforeEach(async () => {
    await resetTestDatabase();
    await fetch(`${MAILPIT_API}/api/v1/messages`, { method: 'DELETE' });
  });

  afterAll(() => disconnectTestDatabase());

  const invitedEvent = async () => {
    const seeded = await seedEvent(prisma);
    const event = await prisma.event.findUniqueOrThrow({ where: { id: seeded.eventId } });
    await prisma.messageTemplate.create({
      data: {
        organizationId: event.organizationId,
        key: 'invitation.send',
        channel: MessageChannel.EMAIL,
        subject: { hy: 'Հրավեր {{hosts}}-ից' },
        body: { hy: 'Հարգելի {{guestName}}, սիրով հրավիրում ենք Ձեզ։ {{link}}' },
      },
    });

    const household = await prisma.household.create({
      data: { eventId: event.id, name: 'Petrosyan family', seatsAllotted: 3 },
    });
    await prisma.guest.createMany({
      data: [
        {
          eventId: event.id,
          householdId: household.id,
          firstName: 'Armen',
          lastName: 'Petrosyan',
          email: 'armen@test.local',
          isPrimary: true,
          token: 'tok-armen',
        },
        {
          eventId: event.id,
          householdId: household.id,
          firstName: 'Lusine',
          lastName: 'Petrosyan',
          email: 'lusine@test.local',
          token: 'tok-lusine',
        },
      ],
    });

    return seeded;
  };

  it('turns a guest list into real, personalised email', async () => {
    const { slug } = await invitedEvent();

    const result = await sender.send(slug);
    const dispatched = await communications.dispatchDue();

    expect(result.queued).toBeGreaterThanOrEqual(1);
    expect(dispatched.sent).toBe(result.queued);

    const delivered = (await inbox()).find(
      (message) => message.To[0]?.Address === 'armen@test.local',
    );
    expect(delivered).toBeDefined();

    // The subject survived the wire in Armenian, and the body carries this
    // guest's own token — the whole point of the email.
    expect(delivered?.Subject).toBe('Հրավեր A & B-ից');
    const text = await textOf(delivered!.ID);
    expect(text).toContain('Հարգելի Armen Petrosyan');
    expect(text).toContain(`https://aveline.test/invitations/${slug}/g/tok-armen`);
  });

  // One family, one email — asserted on what actually arrived, not on what
  // was planned.
  it('does not write to the rest of the household', async () => {
    const { slug } = await invitedEvent();

    await sender.send(slug);
    await communications.dispatchDue();

    const addresses = (await inbox()).flatMap((message) =>
      message.To.map((recipient) => recipient.Address),
    );
    expect(addresses).toContain('armen@test.local');
    expect(addresses).not.toContain('lusine@test.local');
  });

  it('sends nothing more when send is pressed again', async () => {
    const { slug } = await invitedEvent();
    await sender.send(slug);
    await communications.dispatchDue();
    const afterFirst = (await inbox()).length;

    await sender.send(slug);
    await communications.dispatchDue();

    expect((await inbox()).length).toBe(afterFirst);
  });

  it('records delivery against the household afterwards', async () => {
    const { slug } = await invitedEvent();

    await sender.send(slug);
    await communications.dispatchDue();

    const status = await sender.deliveryStatus(slug);
    const petrosyans = status.households.find((row) => row.household === 'Petrosyan family');
    expect(petrosyans).toMatchObject({ status: 'SENT', toAddress: 'armen@test.local' });
    expect(petrosyans?.sentAt).not.toBeNull();
  });
});
