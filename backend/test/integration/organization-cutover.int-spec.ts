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
  it('refuses enabling new writes when activation evidence is unavailable', async () => {
    await expect(execute(process.execPath, [script, 'enable-writes'], { env })).rejects.toThrow('nonexistent-organization-cutover-evidence');
    expect((await prisma.runtimeCompatibility.findUniqueOrThrow({ where: { id: 'organization-context' } })).multiOrganizationWrites).toBe(false);
  });
});
