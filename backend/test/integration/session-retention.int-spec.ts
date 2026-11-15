import { PrismaService } from '../../src/prisma/prisma.service';
import { pruneSessions } from '../../src/infra/auth/session-retention';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

const prisma = testPrisma() as PrismaService;
const NOW = new Date('2026-11-14T09:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

/**
 * Sessions carry an IP address and a browser. They go 30 days after the
 * session ends (decided 14 November 2026), but a replaced refresh token's row
 * stays until the token itself expires: its reuse is how theft is noticed.
 */
describe('Session retention', () => {
  beforeEach(resetTestDatabase);
  afterAll(disconnectTestDatabase);

  const session = async (name: string, times: { expiresAt: Date; revokedAt?: Date }) => {
    const user = await prisma.user.upsert({ where: { email: 'ani@aveline.am' }, update: {}, create: { email: 'ani@aveline.am', name: 'Ani', passwordHash: 'unused' } });
    return prisma.session.create({
      data: { userId: user.id, tokenHash: name, ipAddress: '203.0.113.7', userAgent: 'Firefox', expiresAt: times.expiresAt, revokedAt: times.revokedAt ?? null },
    });
  };
  const remaining = () => prisma.session.findMany({ select: { tokenHash: true, ipAddress: true, userAgent: true }, orderBy: { tokenHash: 'asc' } });

  it('deletes a session more than 30 days past its expiry and keeps one at 30', async () => {
    await session('expired-31', { expiresAt: daysAgo(31) });
    await session('expired-30', { expiresAt: daysAgo(30) });
    await session('live', { expiresAt: daysAgo(-10) });

    await expect(pruneSessions(prisma, NOW)).resolves.toEqual({ deleted: 1, forgotten: 0 });

    expect((await remaining()).map((row) => row.tokenHash)).toEqual(['expired-30', 'live']);
  });

  it('forgets where a session was used 30 days after it ended, keeping the row until its token expires', async () => {
    await session('signed-out-31', { expiresAt: daysAgo(-5), revokedAt: daysAgo(31) });
    await session('signed-out-30', { expiresAt: daysAgo(-5), revokedAt: daysAgo(30) });

    await expect(pruneSessions(prisma, NOW)).resolves.toEqual({ deleted: 0, forgotten: 1 });

    expect(await remaining()).toEqual([
      { tokenHash: 'signed-out-30', ipAddress: '203.0.113.7', userAgent: 'Firefox' },
      { tokenHash: 'signed-out-31', ipAddress: null, userAgent: null },
    ]);
  });

  it('touches a forgotten session only once', async () => {
    await session('signed-out', { expiresAt: daysAgo(-5), revokedAt: daysAgo(40) });

    await pruneSessions(prisma, NOW);
    await expect(pruneSessions(prisma, NOW)).resolves.toEqual({ deleted: 0, forgotten: 0 });
  });
});
