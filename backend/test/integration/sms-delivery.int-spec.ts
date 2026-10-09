import { MessageChannel, MessageStatus, PrismaClient } from '@prisma/client';
import { MessageTransport } from '../../src/modules/communications/channels/message-channel';
import { SmsProvider, SmsTransport } from '../../src/modules/communications/channels/sms.transport';
import { CommunicationsService } from '../../src/modules/communications/communications.service';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * A text through the outbox, against a stand-in provider — the provider is
 * chosen later (decided 9 October 2026); everything on our side of it is
 * exercised here: rendering, dispatch, the number's form, and what a number
 * that cannot be texted does to the guest's record.
 */
describe('SMS delivery (integration)', () => {
  let prisma: PrismaClient;
  let communications: CommunicationsService;
  const sent: [string, string][] = [];
  let organizationId: string;

  const provider: SmsProvider = {
    name: 'stand-in',
    send: (to, text) => {
      sent.push([to, text]);
      return Promise.resolve({ providerRef: `sms-${sent.length}` });
    },
  };

  beforeAll(() => {
    prisma = testPrisma();
    communications = new CommunicationsService(
      prisma as unknown as PrismaService,
      new Map<MessageChannel, MessageTransport>([
        [MessageChannel.SMS, new SmsTransport({ provider, defaultCountryCode: '374' })],
      ]),
      new SuppressionService(prisma as unknown as PrismaService),
    );
  });

  beforeEach(async () => {
    await resetTestDatabase();
    sent.length = 0;
    const { eventId } = await seedEvent(prisma);
    organizationId = (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).organizationId;
    await prisma.messageTemplate.create({
      data: { organizationId, key: 'rsvp.reminder', channel: MessageChannel.SMS, body: { hy: '{{guestName}}, {{link}}' } },
    });
  });

  afterAll(() => disconnectTestDatabase());

  const text = (toAddress: string) =>
    communications.enqueue({
      organizationId,
      channel: MessageChannel.SMS,
      templateKey: 'rsvp.reminder',
      toAddress,
      locale: 'hy',
      variables: { guestName: 'Ani', link: 'https://aveline.test/x' },
    });

  it('sends the rendered text to the number in international form', async () => {
    const message = await text('091 000000');

    await communications.dispatchDue();

    expect(sent).toEqual([['+37491000000', 'Ani, https://aveline.test/x']]);
    const row = await prisma.message.findUniqueOrThrow({ where: { id: message.id } });
    expect(row).toMatchObject({ status: MessageStatus.SENT, providerRef: 'sms-1' });
  });

  it('marks a number that cannot be texted as bounced, and stops writing to it', async () => {
    const message = await text('91 000000');

    await communications.dispatchDue();

    expect(sent).toEqual([]);
    expect((await prisma.message.findUniqueOrThrow({ where: { id: message.id } })).status).toBe(MessageStatus.BOUNCED);
    expect(await prisma.suppression.count({ where: { channel: MessageChannel.SMS, address: '91 000000' } })).toBe(1);
  });
});
