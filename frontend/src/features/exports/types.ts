/**
 * Private snapshot exports (docs/API.md §6, "Private snapshot exports"). Responses are typed by hand,
 * **interim until FR-1**, from `export-snapshots.service.ts` (`snapshotView`), the job recovery
 * interceptor and `exports.service.ts` for the legacy records.
 */

/** In the API's order, which the form keeps. */
export const EXPORT_KINDS = [
  'GUEST_LIST',
  'SEATING_CHART',
  'PLACE_CARDS',
  'CATERING_SHEET',
  'BAR_SHEET',
  'PLAYLIST',
  'TICKET_MANIFEST',
] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

/** In the order the form offers them: print, spreadsheet, other software (design PD-74). */
export const EXPORT_FORMATS = ['PDF', 'XLSX', 'CSV'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const SNAPSHOT_STATUSES = ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED'] as const;
export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number];

/** What a request asks for; the same key with other intent is a 409. */
export interface Intent {
  kind: ExportKind;
  format: ExportFormat;
  locale: string;
  includesContacts: boolean;
}

/** `JobRecoveryDto`: the backend's display words for a failure, in the language asked for. */
export interface Recovery {
  code: string;
  locale: string;
  userMessage: string;
  action: string;
}

/** A snapshot as the page keeps it. Its download address is never kept: the client builds it. */
export interface Snapshot extends Intent {
  id: string;
  status: SnapshotStatus;
  /** At most three, crash recovery included. */
  attempts: number;
  /** A stable code, worded by `FAILURES` in `states.ts`, or `null`. */
  failureReason: string | null;
  recovery: Recovery | null;
  /** When the worker read the event; `null` until an attempt captured it. */
  snapshotAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Whether the server offers the file now: completed, neither revoked nor expired. */
  isDownloadable: boolean;
}

/** A record from before snapshots: its download builds today's data, so it is never offered. */
export interface LegacyExport {
  id: string;
  kind: ExportKind;
  format: string;
  createdAt: string;
}

// ── On the wire ──

export interface SnapshotWire {
  id: string;
  kind: string;
  format: string;
  locale: string;
  includesContacts: boolean;
  status: string;
  attempts: number;
  failureReason: string | null;
  recovery?: Recovery | null;
  snapshotAt: string | null;
  timezone: string | null;
  attendanceRevision: number | null;
  dataRevision: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  completedAt: string | null;
  downloadPath: string | null;
}

export interface LegacyExportWire {
  id: string;
  kind: string;
  format: string;
  status: string;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
  isSnapshot: boolean;
  requiresRegeneration: boolean;
  downloadPath: string;
}
