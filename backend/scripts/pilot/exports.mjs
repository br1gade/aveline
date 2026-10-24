import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { poll } from './client.mjs';
import { locales } from './journey.mjs';

const kinds = ['GUEST_LIST', 'SEATING_CHART', 'PLACE_CARDS', 'CATERING_SHEET', 'BAR_SHEET', 'PLAYLIST', 'TICKET_MANIFEST'];
export async function checkExports(context, environment) {
  const prefix = `/events/${context.event.id}/export-snapshots`;
  const files = [];
  let first;
  for (const locale of locales) {
    for (const kind of kinds) {
      for (const format of ['CSV', 'PDF', 'XLSX']) {
        const job = await context.host('POST', prefix, { kind, format, locale, idempotencyKey: randomUUID() });
        const completed = await poll(() => context.host('GET', `${prefix}/${job.id}`), (value) => ['COMPLETED', 'FAILED'].includes(value.status), 'export completion', { timeoutMs: 120000, intervalMs: 2000 });
        assert.equal(completed.status, 'COMPLETED', `Export ${kind}/${format}/${locale} must complete`);
        const result = await context.host('GET', `${prefix}/${job.id}/download`, undefined, { bytes: true });
        assert.ok(result.headers.get('cache-control').includes('no-store'));
        assert.ok(result.buffer.length > 0);
        if (format === 'PDF') assert.equal(result.buffer.subarray(0, 5).toString(), '%PDF-');
        if (format === 'XLSX') assert.equal(result.buffer.subarray(0, 2).toString(), 'PK');
        const hash = createHash('sha256').update(result.buffer).digest('hex');
        const filename = `${kind}-${locale}.${format.toLowerCase()}`;
        await writeFile(join(environment.outputRoot, 'artifacts', filename), result.buffer);
        files.push({ filename, bytes: result.buffer.length, sha256: hash, attempts: completed.attempts, lagMs: Date.parse(completed.completedAt) - Date.parse(completed.createdAt) });
        await writeFile(join(environment.outputRoot, 'exports-progress.json'), JSON.stringify(files, null, 2));
        first ??= { id: job.id, hash };
      }
    }
    console.log(`J: all 21 ${locale} snapshot combinations completed`);
  }
  await context.host('PATCH', `/events/${context.event.id}`, { title: 'Changed after fixed snapshots' });
  const original = await context.host('GET', `${prefix}/${first.id}/download`, undefined, { bytes: true });
  assert.equal(createHash('sha256').update(original.buffer).digest('hex'), first.hash);
  return { combinations: files.length, isImmutable: true, files, firstId: first.id };
}
