import { mkdtemp, rm, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EnquiryJournal, RedactionReceipt } from './enquiry-journal';

describe('independent protected journal writers', () => {
  let directory: string;
  const key = 'j'.repeat(32);
  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'intake-writers-')); await new EnquiryJournal(directory, key).initialize(); });
  afterEach(async () => rm(directory, { recursive: true, force: true }));
  function receipt(id: string): RedactionReceipt { return { id, enquiryId: `case-${id}`, contactId: `contact-${id}`, privacyRevision: 1, reason: 'VERIFIED_ERASURE', redactedAt: '2026-10-26T10:00:00.000Z' }; }
  it('serializes two actual writer processes and fails closed on missing sequence', async () => {
    const first = new EnquiryJournal(directory, key);
    const other = new EnquiryJournal(directory, key);
    await Promise.all([first.append([receipt('first')], 0), other.append([receipt('other')], 0)]);
    expect((await first.readVerified()).map((entry) => entry.id).sort()).toEqual(['first', 'other']);
    await unlink(join(directory, '1.json'));
    await expect(first.readVerified()).rejects.toThrow();
  });
  it('recovers an actual killed writer after sequence fsync and before manifest acknowledgement', async () => {
    const crashed = await new Promise<number | null>((resolve, reject) => {
      const child = spawn('flock', ['-x', join(directory, '.journal.lock'), process.execPath, join(process.cwd(), 'scripts/intake-journal-writer.mjs')], { env: { ...process.env, NODE_ENV: 'test', INTAKE_JOURNAL_CRASH_AFTER_SEQUENCE: 'true' }, stdio: ['pipe', 'ignore', 'ignore'] });
      child.on('error', reject);
      child.on('close', resolve);
      child.stdin.end(JSON.stringify({ directory, key, minimumSequence: 0, receipts: [receipt('crashed')] }));
    });
    expect(crashed).not.toBe(0);
    const journal = new EnquiryJournal(directory, key);
    await journal.append([receipt('after-crash')], 0);
    expect((await journal.readVerified()).map((entry) => entry.id)).toEqual(['crashed', 'after-crash']);
    expect((await journal.append([receipt('crashed')], 2))[0].sequence).toBe(1);
  });
});
