import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';

export async function runConflictFixture(prisma, action, state) {
  const event = JSON.parse(await readFile(join(state, 'event.json'), 'utf8'));
  const save = (name, value) => writeFile(join(state, `${name}.json`), JSON.stringify(value), { mode: 0o600 });
  const { id } = JSON.parse(await readFile(join(state, 'image-job.json'), 'utf8'));
  const image = await prisma.guestMedia.findUniqueOrThrow({ where: { id, eventId: event.id } });
  if (!/^[0-9a-f-]{36}$/.test(image.sourceKey)) throw new Error('Expected generated private key');
  const source = join(process.env.PRIVATE_STORAGE_ROOT, image.sourceKey);
  if (action === 'hold-image') {
    await rename(source, `${source}.held`);
    try { await promisify(execFile)('mkfifo', [source]); }
    catch (error) { await rename(`${source}.held`, source); throw error; }
  } else if (action === 'release-image') {
    await unlink(source); await rename(`${source}.held`, source);
  } else if (action === 'image-recovery-report') {
    const keys = [image.sourceKey, image.displayKey, image.thumbnailKey].filter(Boolean);
    const files = await Promise.all(keys.map((key) => readFile(join(process.env.PRIVATE_STORAGE_ROOT, key))));
    const bytes = files.reduce((total, buffer) => total + buffer.length, 0);
    await save('image-recovery-report', { attempts: image.attempts, status: image.processingStatus, sourceBytes: image.sourceBytes,
      isLeaseCleared: image.leaseUntil === null && image.claimToken === null, objects: files.length,
      isQuotaReconciled: bytes === image.storedBytes && bytes === image.reservedBytes, width: image.width, height: image.height });
  } else throw new Error('Unknown conflict fixture action');
}
