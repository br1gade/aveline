import { describe, expect, it } from 'vitest';

import { readLegacyExports, readSnapshot, readSnapshots } from './read';
import { legacyWire, snapshot, snapshotWire } from './test-data';
import type { LegacyExportWire, SnapshotWire } from './types';

/** Made at run time: whatever an answer carries beyond its fields must stop at the reader. */
const TOKEN = `tok-${crypto.randomUUID()}`;

describe('reading export answers by naming their fields', () => {
  it('keeps what the page shows and never the download address', () => {
    const wire = { ...snapshotWire(), guestToken: TOKEN } as SnapshotWire;
    const read = readSnapshot(wire);
    expect(read).toEqual(snapshot());
    expect(JSON.stringify(read)).not.toContain(TOKEN);
    expect(JSON.stringify(read)).not.toContain('/download');
  });

  it('reads a file the server no longer offers as not downloadable', () => {
    expect(readSnapshot(snapshotWire({ downloadPath: null }))?.isDownloadable).toBe(false);
  });

  it('reads a status it does not know as ended', () => {
    expect(readSnapshot(snapshotWire({ status: 'PAUSED' }))?.status).toBe('FAILED');
  });

  it('keeps the recovery words the backend sent, and none when it sent none', () => {
    const recovery = {
      code: 'JOB_FAILED',
      locale: 'hy',
      userMessage: 'Առաջադրանքը չհաջողվեց։',
      action: 'RETRY',
      extra: TOKEN,
    };
    const failed = snapshotWire({ status: 'FAILED', failureReason: 'GENERATION_FAILED', recovery });
    expect(readSnapshot(failed)?.recovery).toEqual({
      code: 'JOB_FAILED',
      locale: 'hy',
      userMessage: 'Առաջադրանքը չհաջողվեց։',
      action: 'RETRY',
    });
    const { recovery: _absent, ...without } = snapshotWire();
    expect(readSnapshot(without)?.recovery).toBeNull();
  });

  it('leaves out a kind or format this client does not know, rather than mislabel it', () => {
    const wire = [
      snapshotWire({ id: 's1' }),
      snapshotWire({ id: 's2', kind: 'VENDOR_SHEET' }),
      snapshotWire({ id: 's3', format: 'ODS' }),
    ];
    expect(readSnapshots(wire).map((each) => each.id)).toEqual(['s1']);
  });

  it('reads an earlier export as what it was and when, without its live download', () => {
    const wire = [
      { ...legacyWire(), token: TOKEN } as LegacyExportWire,
      legacyWire({ id: 'x2', kind: 'NOT_A_KIND' }),
    ];
    const read = readLegacyExports(wire);
    expect(read).toEqual([
      { id: 'x1', kind: 'GUEST_LIST', format: 'CSV', createdAt: '2026-10-09T08:00:00.000Z' },
    ]);
    expect(JSON.stringify(read)).not.toContain(TOKEN);
    expect(JSON.stringify(read)).not.toContain('/download');
  });
});
