import {
  EXPORT_FORMATS,
  EXPORT_KINDS,
  SNAPSHOT_STATUSES,
  type ExportFormat,
  type ExportKind,
  type LegacyExport,
  type LegacyExportWire,
  type Recovery,
  type Snapshot,
  type SnapshotStatus,
  type SnapshotWire,
} from './types';

/**
 * Where export answers arrive. Every object is built by naming its fields, never by spreading the
 * response, so a field added later stops here. None of these answers carries a guest's token
 * (checked against `export-snapshots.service.ts` and `exports.service.ts` on 30 October 2026), and
 * no download address is kept: the client builds it, so nothing stores a file's URL.
 */

function kindOf(value: string): ExportKind | undefined {
  return EXPORT_KINDS.find((kind) => kind === value);
}

function formatOf(value: string): ExportFormat | undefined {
  return EXPORT_FORMATS.find((format) => format === value);
}

/** A status this client does not know is read as ended, so the page never waits on it forever. */
function statusOf(value: string): SnapshotStatus {
  return SNAPSHOT_STATUSES.find((status) => status === value) ?? 'FAILED';
}

function readRecovery(recovery: Recovery | null | undefined): Recovery | null {
  if (!recovery) return null;
  const { code, locale, userMessage, action } = recovery;
  return { code, locale, userMessage, action };
}

/** `undefined` for a kind or format this client does not know: it could not be labelled. */
export function readSnapshot(wire: SnapshotWire): Snapshot | undefined {
  const kind = kindOf(wire.kind);
  const format = formatOf(wire.format);
  if (!kind || !format) return undefined;
  return {
    id: wire.id,
    kind,
    format,
    locale: wire.locale,
    includesContacts: wire.includesContacts,
    status: statusOf(wire.status),
    attempts: wire.attempts,
    failureReason: wire.failureReason,
    recovery: readRecovery(wire.recovery),
    snapshotAt: wire.snapshotAt,
    expiresAt: wire.expiresAt,
    revokedAt: wire.revokedAt,
    createdAt: wire.createdAt,
    completedAt: wire.completedAt,
    isDownloadable: wire.downloadPath !== null,
  };
}

/** The history, newest first as it came (at most fifty), less what could not be labelled. */
export function readSnapshots(wire: readonly SnapshotWire[]): Snapshot[] {
  return wire.flatMap((each) => readSnapshot(each) ?? []);
}

/** Only what was asked for and when; never `downloadPath`, which builds today's data. */
export function readLegacyExports(wire: readonly LegacyExportWire[]): LegacyExport[] {
  return wire.flatMap((each) => {
    const kind = kindOf(each.kind);
    return kind ? [{ id: each.id, kind, format: each.format, createdAt: each.createdAt }] : [];
  });
}
