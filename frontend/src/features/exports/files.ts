import type { ExportFormat, Snapshot } from './types';

/** The backend's types and extensions (`EXPORT_TYPES` in `renderers/export-document.ts`). */
const FILE_TYPES: Readonly<Record<ExportFormat, { mediaType: string; extension: string }>> = {
  PDF: { mediaType: 'application/pdf', extension: 'pdf' },
  XLSX: {
    mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    extension: 'xlsx',
  },
  CSV: { mediaType: 'text/csv', extension: 'csv' },
};

/**
 * Whether an answer is the file asked for. Anything else, such as a proxy's error page, is
 * refused rather than saved under a `.pdf` name.
 */
export function isExpectedType(format: ExportFormat, contentType: string): boolean {
  const mediaType = contentType.split(';')[0]?.trim().toLowerCase();
  return mediaType === FILE_TYPES[format].mediaType;
}

/**
 * The server's name for the file, or the same name built here when `Content-Disposition` cannot
 * be read, as cross-origin until the backend exposes it (FR-10).
 */
export function fileNameOf(snapshot: Snapshot, served: string | undefined): string {
  if (served) return served;
  const kind = snapshot.kind.toLowerCase().replace(/_/g, '-');
  return `${kind}-${snapshot.id}.${FILE_TYPES[snapshot.format].extension}`;
}
