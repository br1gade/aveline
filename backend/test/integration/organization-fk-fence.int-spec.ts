import { lockOrganizationStanding } from '../../src/infra/auth/access-locks';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const prisma = testPrisma();
function barrier() {
  let release!: () => void;
  return { wait: new Promise<void>((resolve) => { release = resolve; }), release: () => release() };
}
async function fixture() {
  const organization = await prisma.organization.create({ data: { name: 'Family' } });
  const invite = await prisma.organizationInvite.create({ data: { organizationId: organization.id, email: 'member@test.local', role: 'MEMBER', tokenHash: 'fixture_hash', expiresAt: new Date(Date.now() + 60_000) } });
  return { organization, invite };
}

describe('organization authority fence foreign-key compatibility', () => {
  beforeEach(resetTestDatabase);
  afterAll(disconnectTestDatabase);
  it('allows an erasure FK insert after an invitation lock while membership lifecycle is fenced', async () => {
    const { organization, invite } = await fixture();
    const entered = barrier(); const proceed = barrier();
    const lifecycle = prisma.$transaction(async (tx) => {
      await lockOrganizationStanding(tx, { organizationId: organization.id, mode: 'update' });
      entered.release(); await proceed.wait;
    });
    await entered.wait;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM organization_invites WHERE id = ${invite.id} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organization.id} FOR KEY SHARE NOWAIT`;
        await tx.suppression.create({ data: { organizationId: organization.id, channel: 'EMAIL', address: 'f'.repeat(64), reason: 'ERASED' } });
      });
      expect(await prisma.suppression.count({ where: { organizationId: organization.id } })).toBe(1);
    } finally { proceed.release(); await lifecycle; }
  });
  it('still excludes the SHARE fence taken by role writers and authorized workers', async () => {
    const { organization } = await fixture();
    const entered = barrier(); const proceed = barrier();
    const lifecycle = prisma.$transaction(async (tx) => {
      await lockOrganizationStanding(tx, { organizationId: organization.id, mode: 'update' });
      entered.release(); await proceed.wait;
    });
    await entered.wait;
    try {
      await expect(prisma.$transaction((tx) => tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organization.id} FOR SHARE NOWAIT`)).rejects.toMatchObject({ code: 'P2010', meta: { code: '55P03' } });
    } finally { proceed.release(); await lifecycle; }
    await expect(prisma.$transaction((tx) => lockOrganizationStanding(tx, { organizationId: organization.id }))).resolves.toBeUndefined();
  });
});
