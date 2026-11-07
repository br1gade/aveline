import type { LegacyExportWire, Snapshot, SnapshotWire } from './types';

/** A snapshot as `snapshotView` answers it, ready unless the test says otherwise. */
export function snapshotWire(overrides: Partial<SnapshotWire> = {}): SnapshotWire {
  return {
    id: 's1',
    kind: 'GUEST_LIST',
    format: 'PDF',
    locale: 'hy',
    includesContacts: true,
    status: 'COMPLETED',
    attempts: 1,
    failureReason: null,
    recovery: null,
    snapshotAt: '2026-10-30T10:05:00.000Z',
    timezone: 'Asia/Yerevan',
    attendanceRevision: 2,
    dataRevision: '812:812:',
    expiresAt: '2026-11-06T10:05:30.000Z',
    revokedAt: null,
    createdAt: '2026-10-30T10:04:58.000Z',
    completedAt: '2026-10-30T10:05:30.000Z',
    downloadPath: '/api/v1/events/e1/export-snapshots/s1/download',
    ...overrides,
  };
}

/** The same snapshot as the page keeps it. */
export function snapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    id: 's1',
    kind: 'GUEST_LIST',
    format: 'PDF',
    locale: 'hy',
    includesContacts: true,
    status: 'COMPLETED',
    attempts: 1,
    failureReason: null,
    recovery: null,
    snapshotAt: '2026-10-30T10:05:00.000Z',
    expiresAt: '2026-11-06T10:05:30.000Z',
    revokedAt: null,
    createdAt: '2026-10-30T10:04:58.000Z',
    completedAt: '2026-10-30T10:05:30.000Z',
    isDownloadable: true,
    ...overrides,
  };
}

export function legacyWire(overrides: Partial<LegacyExportWire> = {}): LegacyExportWire {
  return {
    id: 'x1',
    kind: 'GUEST_LIST',
    format: 'CSV',
    status: 'COMPLETED',
    failureReason: null,
    createdAt: '2026-10-09T08:00:00.000Z',
    completedAt: '2026-10-09T08:00:00.000Z',
    isSnapshot: false,
    requiresRegeneration: true,
    downloadPath: '/api/v1/events/e1/exports/x1/download',
    ...overrides,
  };
}
