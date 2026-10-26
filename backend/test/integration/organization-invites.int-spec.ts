import { ConfigService } from '@nestjs/config';
import { hash } from 'bcrypt';
import { AccountService } from '../../src/infra/auth/account.service';
import { CommunicationsService } from '../../src/modules/communications/communications.service';
import { SuppressionService } from '../../src/modules/communications/suppression.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const prisma = testPrisma();
const database = prisma as PrismaService;
const communications = new CommunicationsService(database, new Map(), new SuppressionService(database));
const accounts = new AccountService(database, communications, new ConfigService({ NODE_ENV: 'test', DEFAULT_LOCALE: 'en', APP_URL: 'http://localhost' }));
async function fixture() {
  const owner = await prisma.user.create({ data: { email: 'owner@example.test', name: 'Owner', platformRole: 'ADMIN' } });
  const organization = await prisma.organization.create({ data: { name: 'Family' } });
  await prisma.messageTemplate.create({ data: { key: 'organization.invite', channel: 'EMAIL', body: { en: '{{link}}' } } });
  const invite = await accounts.inviteMember(organization.id, owner.id, { email: 'member@example.test', role: 'MEMBER' });
  return { organization, owner, invite, token: new URL(invite.devLink!).searchParams.get('token')! };
}

describe('organization invite lifecycle', () => {
  beforeEach(resetTestDatabase);
  afterAll(disconnectTestDatabase);
  it('same accepted token returns current role without restoring an older invite role', async () => {
    const { token, organization } = await fixture();
    const dto = { token, name: 'Member', password: 'correct password 123' };
    await accounts.acceptInvite(dto);
    await prisma.organizationMembership.updateMany({ where: { organizationId: organization.id }, data: { role: 'MANAGER' } });
    await expect(accounts.acceptInvite(dto)).resolves.toMatchObject({ ok: true, role: 'MANAGER', accountCreated: false });
  });
  it('a departed accepted token never rejoins', async () => {
    const { token } = await fixture();
    const dto = { token, name: 'Member', password: 'correct password 123' };
    await accounts.acceptInvite(dto);
    await prisma.organizationMembership.deleteMany();
    await expect(accounts.acceptInvite(dto)).rejects.toThrow('no longer valid');
  });
  it('existing current member role survives a previously issued invitation', async () => {
    const { token, organization } = await fixture();
    const user = await prisma.user.create({ data: { email: 'member@example.test', name: 'Member', passwordHash: await hash('correct password 123', 4) } });
    await prisma.organizationMembership.create({ data: { userId: user.id, organizationId: organization.id, role: 'OWNER' } });
    await expect(accounts.acceptInvite({ token, name: 'Member', password: 'correct password 123' })).resolves.toMatchObject({ role: 'OWNER' });
  });
});
