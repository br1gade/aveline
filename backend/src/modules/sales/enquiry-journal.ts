import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, open, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';

export interface RedactionReceipt { id: string; enquiryId: string; contactId: string; reason: 'RETENTION' | 'VERIFIED_ERASURE'; privacyRevision: number; redactedAt: string }
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

  private async write(name: string, value: object): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = join(this.directory, name);
    const temporary = `${path}.${crypto.randomUUID()}.tmp`;
    const file = await open(temporary, 'wx', 0o600);
    try { await file.writeFile(JSON.stringify(value)); await file.sync(); }
    finally { await file.close(); }
    await rename(temporary, path);
    const directory = await open(this.directory, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
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

  private async saveManifest(record: SignedRecord): Promise<void> {
    const value = { sequence: record.sequence, signature: record.signature };
    await this.write('manifest.json', { ...value, checksum: this.sign(value) });
  }

  async append(receipt: RedactionReceipt): Promise<number> {
    const manifest = await this.manifest(true);
    let record: SignedRecord;
    try { record = JSON.parse(await readFile(join(this.directory, `${receipt.id}.json`), 'utf8')) as SignedRecord; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const payload = { sequence: manifest.sequence + 1, previous: manifest.signature, receipt };
      record = { ...payload, signature: this.sign(payload) };
      await this.write(`${receipt.id}.json`, record);
      await this.write(`${record.sequence}.json`, record);
    }
    this.verify(record, record.sequence, record.previous);
    if (JSON.stringify(record.receipt) !== JSON.stringify(receipt)) throw new Error('Privacy receipt identity mismatch');
    if (record.sequence > manifest.sequence + 1) throw new Error('Privacy journal sequence gap');
    if (record.sequence === manifest.sequence + 1) {
      if (record.previous !== manifest.signature) throw new Error('Privacy journal chain mismatch');
      await this.write(`${record.sequence}.json`, record);
      await this.saveManifest(record);
    }
    return record.sequence;
  }

  private verify(record: SignedRecord, sequence: number, previous: string): void {
    const { signature, ...payload } = record;
    if (record.sequence !== sequence || record.previous !== previous || !this.isSigned(signature, this.sign(payload))) throw new Error('Privacy journal sequence gap or signature mismatch');
  }

  async readVerified(): Promise<RedactionReceipt[]> {
    const manifest = await this.manifest();
    const receipts: RedactionReceipt[] = [];
    let previous = '';
    for (let sequence = 1; sequence <= manifest.sequence; sequence++) {
      const record = JSON.parse(await readFile(join(this.directory, `${sequence}.json`), 'utf8')) as SignedRecord;
      this.verify(record, sequence, previous);
      receipts.push(record.receipt);
      previous = record.signature;
    }
    if (previous !== manifest.signature) throw new Error('Privacy journal high-water mismatch');
    return receipts;
  }
}
