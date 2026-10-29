import { readFileSync } from 'node:fs';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';

/** Executed by flock: the process doing writes owns the lock through fsync. */
// This dedicated helper owns no API request work; bounded stdin framing avoids
// stream-start races while flock remains held by the writing process.
const body = readFileSync(0, 'utf8');
if (body.length > 100000) throw new Error('Journal batch too large');
const input = JSON.parse(body);
if (!input.directory?.startsWith('/') || typeof input.key !== 'string' || input.key.length < 32 || !Array.isArray(input.receipts) || input.receipts.length > 100) throw new Error('Invalid protected journal input');
const sign = (value) => createHmac('sha256', input.key).update(JSON.stringify(value)).digest('hex');
const isSigned = (left, right) => typeof left === 'string' && left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
await mkdir(input.directory, { recursive: true, mode: 0o700 });
async function read(name) { return JSON.parse(await readFile(join(input.directory, name), 'utf8')); }
async function write(name, value) {
  const path = join(input.directory, name);
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value)); await file.sync(); }
  finally { await file.close(); }
  await rename(temporary, path);
  const directory = await open(input.directory, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
let manifest;
try { manifest = await read('manifest.json'); }
catch (error) {
  if (error.code !== 'ENOENT' || input.minimumSequence > 0 || input.initialize !== true) throw new Error('Latest protected journal is missing; remain offline');
  const entries = await readdir(input.directory);
  if (entries.some((entry) => entry !== '.journal.lock')) throw new Error('A nonempty journal cannot be initialized');
  manifest = { sequence: 0, signature: '' };
  manifest.checksum = sign(manifest);
  await write('manifest.json', manifest);
}
if (!isSigned(manifest.checksum, sign({ sequence: manifest.sequence, signature: manifest.signature }))) throw new Error('Invalid latest privacy manifest');
if (manifest.sequence < input.minimumSequence) throw new Error('Protected journal predates acknowledged database checkpoint');
// A writer can die after fsync of the next record but before advancing the
// manifest. Recover that single committed predecessor before accepting new work.
try {
  const interrupted = await read(`${manifest.sequence + 1}.json`);
  const { signature, ...payload } = interrupted;
  if (interrupted.previous !== manifest.signature || !isSigned(signature, sign(payload))) throw new Error('Interrupted journal chain is invalid');
  await write(`${interrupted.receipt.id}.json`, interrupted);
  manifest = { sequence: interrupted.sequence, signature };
  await write('manifest.json', { ...manifest, checksum: sign(manifest) });
} catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!input.receipts.length) {
  const probe = `.readiness-${randomUUID()}`;
  await write(probe, { sequence: manifest.sequence });
  await unlink(join(input.directory, probe));
  const directory = await open(input.directory, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
const results = [];
for (const receipt of input.receipts) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(receipt.id)) throw new Error('Invalid receipt identity');
  let record;
  try { record = await read(`${receipt.id}.json`); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    const payload = { sequence: manifest.sequence + 1, previous: manifest.signature, receipt };
    record = { ...payload, signature: sign(payload) };

  }
  const { signature, ...payload } = record;
  if (!isSigned(signature, sign(payload)) || JSON.stringify(record.receipt) !== JSON.stringify(receipt)) throw new Error('Privacy receipt identity or signature mismatch');
  if (record.sequence > manifest.sequence + 1) throw new Error('Privacy journal gap');
  if (record.sequence <= manifest.sequence) {
    const existing = await read(`${record.sequence}.json`);
    if (existing.signature !== record.signature) throw new Error('Privacy journal receipt sequence disagrees');
  }
  if (record.sequence === manifest.sequence + 1) {
    if (record.previous !== manifest.signature) throw new Error('Privacy journal chain mismatch');
    await write(`${record.sequence}.json`, record);
    if (process.env.INTAKE_JOURNAL_CRASH_AFTER_SEQUENCE === 'true') {
      if (process.env.NODE_ENV !== 'test') throw new Error('Crash injection is test-only');
      process.kill(process.pid, 'SIGKILL');
    }
    await write(`${receipt.id}.json`, record);
    manifest = { sequence: record.sequence, signature: record.signature };
    await write('manifest.json', { ...manifest, checksum: sign(manifest) });
  }
  results.push({ id: receipt.id, sequence: record.sequence });
}
process.stdout.write(JSON.stringify(results));
