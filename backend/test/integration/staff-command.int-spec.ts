import { PlatformRole, VerificationPurpose } from '@prisma/client';
import { runStaffCommand } from '../../src/modules/staff/staff-command';
import { StaffService } from '../../src/modules/staff/staff.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const prisma = testPrisma() as PrismaService;
const run = (args: string[]) => runStaffCommand(args, new StaffService(prisma), prisma);
const AT = new Date('2026-11-01T09:00:00.000Z');

/**
 * The ops command is the one path with no admin behind it: it makes the first
 * admin on a fresh installation, so it is proven against the real database.
 */
describe('The staff ops command', () => {
  beforeEach(resetTestDatabase);
  afterAll(disconnectTestDatabase);

  const registered = async (email: string, role: PlatformRole = PlatformRole.NONE) => {
    const user = await prisma.user.create({ data: { email, name: 'Ani', passwordHash: 'unused', platformRole: role } });
    await prisma.verificationToken.create({
      data: { userId: user.id, purpose: VerificationPurpose.EMAIL_VERIFICATION, tokenHash: `verified-${user.id}`, expiresAt: AT, usedAt: AT },
    });
    return user;
  };

  it('makes the first admin and records that it came from the host', async () => {
    const first = await registered('ani@aveline.am');

    await expect(run(['grant', 'Ani@Aveline.am', 'ADMIN'])).resolves.toBe('ani@aveline.am is now ADMIN');

    expect(await prisma.user.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ platformRole: PlatformRole.ADMIN });
    expect(await prisma.staffRoleChange.findMany({ select: { actorUserId: true, subjectUserId: true, previousRole: true, role: true, source: true } }))
      .toEqual([{ actorUserId: null, subjectUserId: first.id, previousRole: 'NONE', role: 'ADMIN', source: 'OPS' }]);
  });

  it('refuses an account that never verified its address', async () => {
    const user = await prisma.user.create({ data: { email: 'ani@aveline.am', name: 'Ani', passwordHash: 'unused' } });

    await expect(run(['grant', 'ani@aveline.am', 'ADMIN'])).rejects.toMatchObject({ code: 'STAFF_EMAIL_UNVERIFIED' });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ platformRole: PlatformRole.NONE });
  });

  it('revoking an address no account has changes no one’s role', async () => {
    const admin = await registered('admin@aveline.am', PlatformRole.ADMIN);
    const support = await registered('support@aveline.am', PlatformRole.SUPPORT);

    await expect(run(['revoke', 'nobody@aveline.am'])).rejects.toMatchObject({ code: 'STAFF_ACCOUNT_NOT_FOUND' });

    expect(await prisma.user.findMany({ where: { id: { in: [admin.id, support.id] } }, select: { platformRole: true }, orderBy: { email: 'asc' } }))
      .toEqual([{ platformRole: PlatformRole.ADMIN }, { platformRole: PlatformRole.SUPPORT }]);
    expect(await prisma.staffRoleChange.count()).toBe(0);
  });
});
