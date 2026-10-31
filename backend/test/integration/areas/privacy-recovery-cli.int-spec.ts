import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EnquiryJournal } from '../../../src/modules/sales/enquiry-journal';
import { EnquiryPrivacyService } from '../../../src/modules/sales/enquiry-privacy.service';
import { EnquiryRetentionService } from '../../../src/modules/sales/enquiry-retention.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { DAY_MS } from '../../fixtures/areas/privacy.fixture';
import { TEST_DATABASE_URL, disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const JOURNAL_KEY = 'j'.repeat(32);
const RECOVERY_TIMEOUT_MS = 60_000;
// Run from source; the build's tsconfig leaves rootDir to tsc, which ts-node cannot infer.
const TS_NODE_OPTIONS = JSON.stringify({ rootDir: '.' });

interface Run { code: number | null; stdout: string }

/**
 * The offline recovery entrypoint replays the protected journal after a
 * database restore (SALES_INTAKE.md, "Gates and first installation" and
 * "Restoring an older snapshot"). Every gate must refuse — exit non-zero —
 * so an operator cannot bring intake back online on unverified evidence.
 * Each refusal below differs from a passing run by exactly one condition.
 */
describe('Intake privacy recovery entrypoint (integration coverage)', () => {
  let prisma: PrismaClient;
  let directory: string;

  const recover = (env: Record<string, string | undefined>, command?: string) => new Promise<Run>((resolve, reject) => {
    const child = spawn(
      join(process.cwd(), 'node_modules/.bin/ts-node-transpile-only'),
      ['src/intake-privacy-recovery.ts', ...(command ? [command] : [])],
      { cwd: process.cwd(), env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', DATABASE_URL: TEST_DATABASE_URL, TS_NODE_COMPILER_OPTIONS: TS_NODE_OPTIONS, ...env }, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout }));
  });

  const replayEnv = (sequence: number): Record<string, string> => ({
    RESTORE_QUIESCED: 'true', SALES_PRIVACY_JOURNAL_DIR: directory, SALES_PRIVACY_JOURNAL_KEY: JOURNAL_KEY,
    SALES_PRIVACY_JOURNAL_LATEST_VERIFIED: 'true', SALES_PRIVACY_RESTORE_SEQUENCE: String(sequence),
  });
  const initializeEnv = (): Record<string, string> => ({
    RESTORE_QUIESCED: 'true', SALES_PRIVACY_JOURNAL_DIR: directory, SALES_PRIVACY_JOURNAL_KEY: JOURNAL_KEY, SALES_PRIVACY_NEW_INSTALL: 'true',
  });
  const without = (env: Record<string, string>, key: string) => ({ ...env, [key]: undefined });

  /** A closed case whose retention has run, journalled — then a restore that predates it. */
  const journalledThenRestored = async () => {
    await new EnquiryJournal(directory, JOURNAL_KEY).initialize();
    const config = new ConfigService({ SALES_PRIVACY_JOURNAL_DIR: directory, SALES_PRIVACY_JOURNAL_KEY: JOURNAL_KEY });
    const staff = await prisma.user.create({ data: { name: 'Staff', email: 'staff@example.am', platformRole: 'ADMIN' } });
    const now = new Date();
    await prisma.salesEnquiry.create({
      data: {
        id: 'restored-case', createdByUserId: staff.id, stage: 'CLOSED', closedAt: new Date(now.getTime() - 200 * DAY_MS), closureReason: 'OTHER',
        cleanupDueAt: new Date(now.getTime() - DAY_MS), contact: { create: { name: 'Prospect', phone: '+37499123456' } },
      },
    });
    await new EnquiryRetentionService(prisma as unknown as PrismaService, config).clearDue(now);
    await new EnquiryPrivacyService(prisma as unknown as PrismaService, config).checkpoint();
    // The older snapshot: the contact is back and nothing records that it was cleared.
    await prisma.enquiryPrivacyRedaction.deleteMany();
    await prisma.enquiryErasureTombstone.deleteMany();
    await prisma.salesEnquiry.update({ where: { id: 'restored-case' }, data: { personalDataClearedAt: null, clearanceReason: null, cleanupDueAt: new Date(now.getTime() + DAY_MS) } });
    await prisma.enquiryContact.update({ where: { enquiryId: 'restored-case' }, data: { name: 'Prospect', phone: '+37499123456', redactedAt: null } });
  };

  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(async () => {
    await resetTestDatabase();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    directory = await mkdtemp(join(tmpdir(), 'privacy-recovery-cli-'));
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });
  afterAll(() => disconnectTestDatabase());

  describe('initializing a fresh journal', () => {
    it('writes a signed zero journal for an explicit fresh installation with no intake history', async () => {
      const run = await recover(initializeEnv(), 'initialize');

      expect(run.code).toBe(0);
      expect((await new EnquiryJournal(directory, JOURNAL_KEY).manifest()).sequence).toBe(0);
    }, RECOVERY_TIMEOUT_MS);

    it.each(['RESTORE_QUIESCED', 'SALES_PRIVACY_NEW_INSTALL'])('refuses without %s and writes nothing', async (missing) => {
      const run = await recover(without(initializeEnv(), missing), 'initialize');

      expect(run.code).toBe(1);
      expect(await readdir(directory)).toEqual([]);
    }, RECOVERY_TIMEOUT_MS);

    it('refuses when intake history already exists', async () => {
      const staff = await prisma.user.create({ data: { name: 'Staff', email: 'staff@example.am' } });
      await prisma.salesEnquiry.create({ data: { createdByUserId: staff.id, contact: { create: { name: 'Prospect', phone: '+37499123456' } } } });

      const run = await recover(initializeEnv(), 'initialize');

      expect(run.code).toBe(1);
      expect(await readdir(directory)).toEqual([]);
    }, RECOVERY_TIMEOUT_MS);
  });

  describe('replaying after a restore', () => {
    it('re-applies a journalled redaction the restored snapshot lost, and reports nothing outstanding', async () => {
      await journalledThenRestored();

      const run = await recover(replayEnv(1));

      expect(run.code).toBe(0);
      expect(JSON.parse(run.stdout.trim())).toEqual({ replayed: 1, uncheckpointed: 0, overdue: 0, latestSequence: 1 });
      expect(await prisma.enquiryContact.findUniqueOrThrow({ where: { enquiryId: 'restored-case' } })).toMatchObject({ name: null, phone: null });
    }, RECOVERY_TIMEOUT_MS);

    it.each([
      ['the API was not confirmed stopped', (env: Record<string, string>) => without(env, 'RESTORE_QUIESCED')],
      ['the journal was not confirmed the latest', (env: Record<string, string>) => without(env, 'SALES_PRIVACY_JOURNAL_LATEST_VERIFIED')],
      ['the stated sequence is not a number', (env: Record<string, string>) => ({ ...env, SALES_PRIVACY_RESTORE_SEQUENCE: 'abc' })],
      ['the stated sequence differs from the journal', (env: Record<string, string>) => ({ ...env, SALES_PRIVACY_RESTORE_SEQUENCE: '2' })],
    ])('refuses, leaving the restored data untouched, when %s', async (_reason, change) => {
      await journalledThenRestored();

      const run = await recover(change(replayEnv(1)));

      expect(run.code).toBe(1);
      expect((await prisma.enquiryContact.findUniqueOrThrow({ where: { enquiryId: 'restored-case' } })).name).toBe('Prospect');
    }, RECOVERY_TIMEOUT_MS);

    // A dry run reports an overdue case without clearing it, so it remains overdue.
    const overdueCase = async () => {
      await new EnquiryJournal(directory, JOURNAL_KEY).initialize();
      const staff = await prisma.user.create({ data: { name: 'Staff', email: 'staff@example.am' } });
      const now = Date.now();
      const enquiry = await prisma.salesEnquiry.create({
        data: {
          createdByUserId: staff.id, stage: 'CLOSED', closedAt: new Date(now - 200 * DAY_MS), closureReason: 'OTHER',
          cleanupDueAt: new Date(now - DAY_MS), contact: { create: { name: 'Prospect', phone: '+37499123456' } },
        },
      });
      return enquiry.id;
    };

    it('clears an overdue case, journals it and succeeds', async () => {
      const enquiryId = await overdueCase();

      const run = await recover({ ...replayEnv(0), SALES_ENQUIRY_RETENTION_DRY_RUN: 'false' });

      expect(run.code).toBe(0);
      expect(JSON.parse(run.stdout.trim())).toEqual({ replayed: 0, uncheckpointed: 0, overdue: 0, latestSequence: 1 });
      expect(await prisma.enquiryContact.findUniqueOrThrow({ where: { enquiryId } })).toMatchObject({ name: null, phone: null });
    }, RECOVERY_TIMEOUT_MS);

    it('stays failed, clearing nothing, while a dry run leaves a case overdue', async () => {
      const enquiryId = await overdueCase();

      const run = await recover({ ...replayEnv(0), SALES_ENQUIRY_RETENTION_DRY_RUN: 'true' });

      expect(run.code).toBe(1);
      expect(run.stdout).toBe('');
      expect(await prisma.enquiryContact.findUniqueOrThrow({ where: { enquiryId } })).toMatchObject({ name: 'Prospect', phone: '+37499123456' });
      expect((await new EnquiryJournal(directory, JOURNAL_KEY).manifest()).sequence).toBe(0);
    }, RECOVERY_TIMEOUT_MS);
  });
});
