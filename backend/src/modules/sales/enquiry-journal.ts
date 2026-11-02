import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

export interface RedactionReceipt { id: string; enquiryId: string; contactId: string; reason: 'RETENTION' | 'VERIFIED_ERASURE'; privacyRevision: number; redactedAt: string; verifiedOwnerUserId?: string }
export interface ReplayedRedactionReceipt extends RedactionReceipt { sequence: number }
interface SignedRecord { sequence: number; previous: string; receipt: RedactionReceipt; signature: string }
interface Manifest { sequence: number; signature: string; checksum: string }

/** The directory must outlive the restored database snapshot. Missing evidence fails closed. */
export class EnquiryJournal {
  constructor(private readonly directory: string, private readonly key: string) {
    if (!directory || key.length < 32) throw new Error('Protected intake journal is not configured');
  }

  private sign(value: object): string { return createHmac('sha256', this.key).update(JSON.stringify(value)).digest('hex'); }
  private isSigned(actual: string, expected: string): boolean {
    const left = Buffer.from(actual);
    const right = Buffer.from(expected);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  async manifest(shouldAllowEmpty = false): Promise<Manifest> {
    try {
      const manifest = JSON.parse(await readFile(join(this.directory, 'manifest.json'), 'utf8')) as Manifest;
      if (!Number.isSafeInteger(manifest.sequence) || manifest.sequence < 0 || !this.isSigned(manifest.checksum, this.sign({ sequence: manifest.sequence, signature: manifest.signature }))) throw new Error('Invalid privacy journal manifest');
      return manifest;
    } catch (error) {
      if (shouldAllowEmpty && (error as NodeJS.ErrnoException).code === 'ENOENT') return { sequence: 0, signature: '', checksum: '' };
      throw new Error('Latest protected privacy journal manifest is missing or invalid', { cause: error });
    }
  }

  async initialize(): Promise<void> {
    await this.runWriter([], 0, true);
    const manifest = await this.manifest();
    if (manifest.sequence !== 0) throw new Error('Only an explicit fresh installation may initialize a zero journal');
  }

  private async runWriter(receipts: RedactionReceipt[], minimumSequence: number, shouldInitialize = false): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await new Promise<void>((resolve, reject) => {
      const child = spawn('flock', ['-x', join(this.directory, '.journal.lock'), process.execPath, join(process.cwd(), 'scripts/intake-journal-writer.mjs')], { stdio: ['pipe', 'ignore', 'ignore'] });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code !== 0) { reject(new Error('Protected journal writer failed; keep recovery offline')); return; }
        resolve();
      });
      child.stdin.on('error', reject);
      child.stdin.end(JSON.stringify({ directory: this.directory, key: this.key, receipts, minimumSequence, initialize: shouldInitialize }));
    });
  }

  async append(receipts: RedactionReceipt[], minimumSequence: number): Promise<{ id: string; sequence: number }[]> {
    await this.runWriter(receipts, minimumSequence);
    const manifest = await this.manifest();
    return Promise.all(receipts.map(async (receipt) => {
      const record = JSON.parse(await readFile(join(this.directory, `${receipt.id}.json`), 'utf8')) as SignedRecord;
      this.verify(record, record.sequence, record.previous);
      if (record.receipt.id !== receipt.id || record.sequence > manifest.sequence) throw new Error('Journal acknowledgement is incomplete');
      return { id: receipt.id, sequence: record.sequence };
    }));
  }

  private verify(record: SignedRecord, sequence: number, previous: string): void {
    const { signature, ...payload } = record;
    if (record.sequence !== sequence || record.previous !== previous || !this.isSigned(signature, this.sign(payload))) throw new Error('Privacy journal sequence gap or signature mismatch');
  }

  async readVerified(): Promise<ReplayedRedactionReceipt[]> {
    const manifest = await this.manifest();
    const receipts: ReplayedRedactionReceipt[] = [];
    let previous = '';
    for (let sequence = 1; sequence <= manifest.sequence; sequence++) {
      const record = JSON.parse(await readFile(join(this.directory, `${sequence}.json`), 'utf8')) as SignedRecord;
      this.verify(record, sequence, previous);
      receipts.push({ ...record.receipt, sequence: record.sequence });
      previous = record.signature;
    }
    if (previous !== manifest.signature) throw new Error('Privacy journal high-water mismatch');
    return receipts;
  }
}
