import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ConfigService } from '@nestjs/config';
import { MessageChannel, PrismaClient } from '@prisma/client';
import { ConsoleTransport } from '../../../src/modules/communications/channels/console.transport';
import { MessageTransport } from '../../../src/modules/communications/channels/message-channel';
import { CommunicationsService } from '../../../src/modules/communications/communications.service';
import { GuestChannelsService } from '../../../src/modules/communications/guest-channels.service';
import { SuppressionService } from '../../../src/modules/communications/suppression.service';
import { InvitationSenderService } from '../../../src/modules/invitations/sending/invitation-sender.service';
import { MESSAGE_COPY } from '../../../src/seed/message-copy';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { seedEvent } from '../../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, TEST_DATABASE_URL, testPrisma } from '../../setup/test-database';

const run = promisify(execFile);
const BACKEND_ROOT = join(__dirname, '..', '..', '..');

/**
 * The production seed's promises (src/seed-production.ts): safe to run on
 * every deploy, never reverts what someone edited, creates no organization,
 * user, event or guest — and leaves Aveline's default copy in place, without
 * which a send "fails partway through a guest list". Run as the deployment
 * runs it, a separate process against the database.
 */
describe('production seed (integration coverage)', () => {
  let prisma: PrismaClient;

  jest.setTimeout(120_000);

  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  const seedProduction = async () => {
    const { stdout } = await run('npx', ['ts-node', 'src/seed-production.ts'], {
      cwd: BACKEND_ROOT, env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    });
    return stdout;
  };

  /** Row ids per seeded table: a re-run that deleted and recreated a row would change them. */
  const ids = (rows: { id: string }[]) => rows.map((row) => row.id).sort();
  const inventory = async () => ({
    designTemplates: ids(await prisma.designTemplate.findMany({ select: { id: true } })),
    messageTemplates: ids(await prisma.messageTemplate.findMany({ select: { id: true } })),
    plans: ids(await prisma.plan.findMany({ select: { id: true } })),
    invoiceCounters: (await prisma.invoiceCounter.findMany({ select: { series: true } })).map((row) => row.series).sort(),
  });

  it('leaves exactly the same rows when run a second time', async () => {
    await seedProduction();
    const first = await inventory();

    const output = await seedProduction();

    expect(await inventory()).toEqual(first);
    expect(first.messageTemplates.length).toBeGreaterThan(0);
    expect(output).toMatch(/message copy:\s+0 created/);
  });

  it('creates no organization, user, event or guest', async () => {
    await seedProduction();

    expect(await prisma.organization.count()).toBe(0);
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.event.count()).toBe(0);
    expect(await prisma.guest.count()).toBe(0);
  });

  it('does not revert copy, a price or a template someone edited in production', async () => {
    await seedProduction();
    const copy = await prisma.messageTemplate.findFirstOrThrow({ where: { organizationId: null, key: 'invitation.send', channel: MessageChannel.EMAIL } });
    await prisma.messageTemplate.update({ where: { id: copy.id }, data: { subject: { hy: 'Edited subject' } } });
    await prisma.plan.update({ where: { key: 'managed' }, data: { priceMinor: 125_000n, isActive: true } });
    // Rendering inputs are versioned by trigger, so the edit an operator can make in place is withdrawing a template.
    await prisma.designTemplate.update({ where: { key: 'classic' }, data: { isActive: false } });

    await seedProduction();

    expect((await prisma.messageTemplate.findUniqueOrThrow({ where: { id: copy.id } })).subject).toEqual({ hy: 'Edited subject' });
    expect(await prisma.plan.findUniqueOrThrow({ where: { key: 'managed' } })).toMatchObject({ priceMinor: 125_000n, isActive: true });
    expect((await prisma.designTemplate.findUniqueOrThrow({ where: { key: 'classic' } })).isActive).toBe(false);
  });

  it('activates only the free plan, since paid prices are an open decision', async () => {
    await seedProduction();

    const active = await prisma.plan.findMany({ where: { isActive: true }, select: { key: true, priceMinor: true } });

    expect(active).toEqual([{ key: 'invitation-free', priceMinor: 0n }]);
  });

  // src/seed/message-copy.spec.ts proves MESSAGE_COPY covers every key the
  // code sends; this proves the seed actually writes all of it as Aveline's
  // active default, which is what an organization with no copy falls back to.
  it('writes every piece of default copy as an active Aveline-wide template', async () => {
    await seedProduction();

    const seeded = await prisma.messageTemplate.findMany({ where: { organizationId: null, isActive: true }, select: { key: true, channel: true } });

    const missing = MESSAGE_COPY.filter((copy) => !seeded.some((row) => row.key === copy.key && row.channel === copy.channel));
    expect(missing.map((copy) => `${copy.channel} ${copy.key}`)).toEqual([]);
    expect(seeded).toHaveLength(MESSAGE_COPY.length);
  });

  it("lets an organization with no copy of its own send its guest list on Aveline's defaults", async () => {
    await seedProduction();
    const event = await seedEvent(prisma);
    await prisma.guest.updateMany({ where: { eventId: event.eventId }, data: { email: 'primary@test.local' } });
    const database = prisma as unknown as PrismaService;
    const transports = new Map<MessageChannel, MessageTransport>(Object.values(MessageChannel).map((channel) => [channel, new ConsoleTransport(channel)]));
    const sender = new InvitationSenderService(database, new CommunicationsService(database, transports, new SuppressionService(database)),
      new GuestChannelsService(database), { get: (key: string) => (key === 'PUBLIC_APP_URL' ? 'https://aveline.test' : undefined) } as unknown as ConfigService);
    sender.onModuleInit();

    const result = await sender.send(event.slug);

    expect(result).toMatchObject({ queued: 1 });
    expect(await prisma.message.count({ where: { eventId: event.eventId, templateKey: 'invitation.send', toAddress: 'primary@test.local' } })).toBe(1);
  });
});
