import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { disconnectTestDatabase, resetTestDatabase, testPrisma, TEST_DATABASE_URL } from '../setup/test-database';

const execute = promisify(execFile);
const prisma = testPrisma();
const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL, ORGANIZATION_CUTOVER_EVIDENCE_FILE: '/tmp/nonexistent-organization-cutover-evidence.json' };
const script = resolve('scripts/organization-cutover.mjs');

describe('organization cutover operator controls', () => {
  beforeEach(resetTestDatabase);
  afterAll(disconnectTestDatabase);
  it('allows emergency write disable without an activation evidence file', async () => {
    await prisma.runtimeCompatibility.update({ where: { id: 'organization-context' }, data: { multiOrganizationWrites: true } });
    await execute(process.execPath, [script, 'disable-writes'], { env });
    expect((await prisma.runtimeCompatibility.findUniqueOrThrow({ where: { id: 'organization-context' } })).multiOrganizationWrites).toBe(false);
  });
  it('requires revision-3 evidence for controlled index cutover and write activation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aveline-reader-floor-'));
    const proofPath = join(directory, 'test-evidence.json');
    const proof = { revision: 2, readerWriterInventory: true, raceTests: true, populatedMigration: true,
      restoreRehearsal: true, fourLanguageTabAcceptance: true, oldRuntimeExclusion: true };
    const cutoverEnvironment = { ...env, ORGANIZATION_CUTOVER_EVIDENCE_FILE: proofPath, ORGANIZATION_CUTOVER_MAINTENANCE: 'confirmed' };
    try {
      await writeFile(proofPath, JSON.stringify(proof));
      await expect(execute(process.execPath, [script, 'drop-single-membership-index'], { env: cutoverEnvironment })).rejects.toThrow('revision-3 activation evidence');
      await writeFile(proofPath, JSON.stringify({ ...proof, revision: 3 }));
      await execute(process.execPath, [script, 'drop-single-membership-index'], { env: cutoverEnvironment });
      await execute(process.execPath, [script, 'enable-writes'], { env: cutoverEnvironment });
      expect(await prisma.runtimeCompatibility.findUniqueOrThrow({ where: { id: 'organization-context' } })).toMatchObject({ minimumRevision: 3, multiOrganizationWrites: true });
    } finally {
      await prisma.runtimeCompatibility.update({ where: { id: 'organization-context' }, data: { multiOrganizationWrites: false } });
      await prisma.$executeRaw`CREATE UNIQUE INDEX IF NOT EXISTS "organization_memberships_userId_key" ON organization_memberships("userId")`;
      await rm(directory, { recursive: true, force: true });
    }
  });
  it('refuses enabling new writes when activation evidence is unavailable', async () => {
    await expect(execute(process.execPath, [script, 'enable-writes'], { env })).rejects.toThrow('nonexistent-organization-cutover-evidence');
    expect((await prisma.runtimeCompatibility.findUniqueOrThrow({ where: { id: 'organization-context' } })).multiOrganizationWrites).toBe(false);
  });
});
