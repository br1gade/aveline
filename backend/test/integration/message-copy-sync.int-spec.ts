import { MessageChannel } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { MESSAGE_COPY } from '../../src/seed/message-copy';
import { syncPlatformCopy } from '../../src/seed/message-copy-sync';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const prisma = testPrisma() as PrismaService;

/**
 * Aveline's own copy lives in code. Production only fills in what is missing
 * (critique-seed.int-spec.ts: an operator's edit survives a redeploy); a
 * development database is refreshed, or it keeps the first wording it ever had.
 */
describe('Syncing Aveline’s own message copy', () => {
  beforeEach(resetTestDatabase);
  afterAll(disconnectTestDatabase);

  const platformCopy = () => prisma.messageTemplate.count({ where: { organizationId: null } });
  const reset = () => prisma.messageTemplate.findFirstOrThrow({ where: { organizationId: null, key: 'account.password-reset', channel: MessageChannel.EMAIL } });

  it('writes every template into an empty database', async () => {
    await expect(syncPlatformCopy(prisma, 'fill')).resolves.toEqual({ created: MESSAGE_COPY.length, updated: 0 });
    expect(await platformCopy()).toBe(MESSAGE_COPY.length);
  });

  it('refreshing brings old wording up to date and leaves current wording alone', async () => {
    await syncPlatformCopy(prisma, 'fill');
    await prisma.messageTemplate.update({ where: { id: (await reset()).id }, data: { subject: { hy: 'old' }, body: { hy: 'old' } } });

    await expect(syncPlatformCopy(prisma, 'refresh')).resolves.toEqual({ created: 0, updated: 1 });
    expect((await reset()).subject).toEqual(MESSAGE_COPY.find((copy) => copy.key === 'account.password-reset')?.subject);
  });

  it('filling leaves existing wording as it is', async () => {
    await syncPlatformCopy(prisma, 'fill');
    await prisma.messageTemplate.update({ where: { id: (await reset()).id }, data: { subject: { hy: 'edited' } } });

    await expect(syncPlatformCopy(prisma, 'fill')).resolves.toEqual({ created: 0, updated: 0 });
    expect((await reset()).subject).toEqual({ hy: 'edited' });
  });

  it('never touches an organization’s own wording', async () => {
    const organization = await prisma.organization.create({ data: { name: 'Petrosyan Wedding', kind: 'HOST' } });
    const own = await prisma.messageTemplate.create({
      data: { organizationId: organization.id, key: 'account.password-reset', channel: MessageChannel.EMAIL, subject: { hy: 'Մեր' }, body: { hy: '{{link}}' } },
    });

    await syncPlatformCopy(prisma, 'refresh');

    expect(await prisma.messageTemplate.findUniqueOrThrow({ where: { id: own.id } })).toMatchObject({ subject: { hy: 'Մեր' } });
  });
});
