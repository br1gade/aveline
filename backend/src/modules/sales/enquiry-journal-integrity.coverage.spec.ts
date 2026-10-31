import { ConfigService } from '@nestjs/config';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { EnquiryJournal, RedactionReceipt } from './enquiry-journal';
import { EnquiryPrivacyService } from './enquiry-privacy.service';

/**
 * The protected journal is the evidence that survives a database restore:
 * replaying it re-applies redactions an older snapshot no longer shows. A
 * journal that can be edited without detection would let a restore bring an
 * erased person back, so every tampering below must fail closed
 * (SALES_INTAKE.md, "Normal recovery and monitoring").
 */
describe('protected journal integrity', () => {
  const key = 'j'.repeat(32);
  let directory: string;

  const receipt = (id: string): RedactionReceipt => ({
    id, enquiryId: `case-${id}`, contactId: `contact-${id}`, privacyRevision: 1, reason: 'VERIFIED_ERASURE', redactedAt: '2026-10-26T10:00:00.000Z',
  });
  const readJson = async (name: string) => JSON.parse(await readFile(join(directory, name), 'utf8')) as Record<string, unknown>;
  const writeJson = (name: string, value: unknown) => writeFile(join(directory, name), JSON.stringify(value));

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'intake-integrity-'));
    const journal = new EnquiryJournal(directory, key);
    await journal.initialize();
    await journal.append([receipt('first')], 0);
    await journal.append([receipt('second')], 1);
  });
  afterEach(() => rm(directory, { recursive: true, force: true }));

  it('reads back an untouched two-entry chain', async () => {
    const entries = await new EnquiryJournal(directory, key).readVerified();

    expect(entries.map((entry) => [entry.id, entry.sequence])).toEqual([['first', 1], ['second', 2]]);
  });

  it('rejects an entry whose receipt was edited after signing', async () => {
    const record = await readJson('1.json');
    await writeJson('1.json', { ...record, receipt: { ...(record.receipt as object), contactId: 'someone-else' } });

    await expect(new EnquiryJournal(directory, key).readVerified()).rejects.toThrow('signature mismatch');
  });

  it('rejects the whole journal when read with a different key', async () => {
    await expect(new EnquiryJournal(directory, 'k'.repeat(32)).readVerified()).rejects.toThrow('manifest is missing or invalid');
  });

  it('rejects a manifest whose sequence was moved without re-signing', async () => {
    const manifest = await readJson('manifest.json');
    await writeJson('manifest.json', { ...manifest, sequence: 1 });

    await expect(new EnquiryJournal(directory, key).manifest()).rejects.toThrow('manifest is missing or invalid');
  });

  it('rejects an entry whose link to its predecessor was swapped', async () => {
    const record = await readJson('2.json');
    await writeJson('2.json', { ...record, previous: 'f'.repeat(64) });

    await expect(new EnquiryJournal(directory, key).readVerified()).rejects.toThrow('sequence gap or signature mismatch');
  });

  it('refuses to start enabled intake against a tampered manifest', async () => {
    const manifest = await readJson('manifest.json');
    await writeJson('manifest.json', { ...manifest, checksum: '0'.repeat(64) });
    const privacy = new EnquiryPrivacyService({} as PrismaService, new ConfigService({
      SALES_INTAKE_ENABLED: 'true', SALES_PRIVACY_JOURNAL_DIR: directory, SALES_PRIVACY_JOURNAL_KEY: key,
    }));

    await expect(privacy.onModuleInit()).rejects.toThrow('Protected journal writer failed');
  });
});
