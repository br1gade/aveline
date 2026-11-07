import { expectData, type ApiClient } from '@/api/client';
import { expectFile, type FetchedFile } from '@/api/file';
import { isLanguage } from '@/lib/i18n';

import { readLegacyExports, readSnapshot, readSnapshots } from './read';
import type { Intent, LegacyExport, LegacyExportWire, Snapshot, SnapshotWire } from './types';

/** A single answer is for an export this client asked for, so its kind and format are known. */
function known(wire: SnapshotWire): Snapshot {
  const snapshot = readSnapshot(wire);
  if (!snapshot) throw new Error(`An export of a kind this client does not know: ${wire.kind}`);
  return snapshot;
}

/** The event's newest fifty snapshots, newest first, a bare array (docs/API.md §6). */
export async function listSnapshots(api: ApiClient, eventId: string): Promise<Snapshot[]> {
  const wire = await expectData<SnapshotWire[]>(
    api.GET('/api/v1/events/{eventId}/export-snapshots', { params: { path: { eventId } } }),
  );
  return readSnapshots(wire);
}

export async function getSnapshot(
  api: ApiClient,
  eventId: string,
  snapshotId: string,
): Promise<Snapshot> {
  const wire = await expectData<SnapshotWire>(
    api.GET('/api/v1/events/{eventId}/export-snapshots/{snapshotId}', {
      params: { path: { eventId, snapshotId } },
    }),
  );
  return known(wire);
}

/**
 * Queues a snapshot. Every part of the intent is sent, so a retry with the same key never depends
 * on the backend's defaults (the event's language, the caller's contact access), which may change
 * between two presses.
 */
export async function createSnapshot(
  api: ApiClient,
  eventId: string,
  intent: Intent,
  idempotencyKey: string,
): Promise<Snapshot> {
  const { kind, format, locale } = intent;
  const wire = await expectData<SnapshotWire>(
    api.POST('/api/v1/events/{eventId}/export-snapshots', {
      params: { path: { eventId } },
      body: {
        kind,
        format,
        idempotencyKey,
        includesContacts: intent.includesContacts,
        ...(isLanguage(locale) ? { locale } : {}),
      },
    }),
  );
  return known(wire);
}

/**
 * The file's bytes, read with the bearer token like any other call: there is no public link to it
 * (docs/API.md §6). Saved from an object URL (`ui/save-file.ts`); never logged or kept.
 */
export function downloadSnapshot(
  api: ApiClient,
  eventId: string,
  snapshotId: string,
): Promise<FetchedFile> {
  return expectFile(
    api.GET('/api/v1/events/{eventId}/export-snapshots/{snapshotId}/download', {
      params: { path: { eventId, snapshotId } },
      parseAs: 'blob',
    }),
  );
}

/** Records from before snapshots, read only to say they must be made again. */
export async function listLegacyExports(api: ApiClient, eventId: string): Promise<LegacyExport[]> {
  const wire = await expectData<LegacyExportWire[]>(
    api.GET('/api/v1/events/{eventId}/exports', { params: { path: { eventId } } }),
  );
  return readLegacyExports(wire);
}
