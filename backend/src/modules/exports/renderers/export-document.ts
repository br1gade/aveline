import { ExportFormat, ExportKind } from '@prisma/client';
import { Sheet } from '../export-sheets';

export interface RenderContext {
  title: string;
  snapshotAt: Date;
  timezone: string;
  locale: string;
  attendanceRevision: number;
  dataRevision: string;
  includesContacts: boolean;
}
export interface RenderInput extends RenderContext { kind: ExportKind; format: ExportFormat; sheet: Sheet }
export interface RenderedFile { buffer: Buffer; mimeType: string; extension: string }
export const EXPORT_TYPES: Record<ExportFormat, { mimeType: string; extension: string }> = {
  CSV: { mimeType: 'text/csv; charset=utf-8', extension: 'csv' },
  PDF: { mimeType: 'application/pdf', extension: 'pdf' },
  XLSX: { mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', extension: 'xlsx' },
};
export const EXPORT_TITLES: Record<ExportKind, string> = {
  GUEST_LIST: 'Guest list', SEATING_CHART: 'Seating chart', PLACE_CARDS: 'Place cards',
  CATERING_SHEET: 'Catering sheet', BAR_SHEET: 'Bar sheet', PLAYLIST: 'Playlist', TICKET_MANIFEST: 'Ticket manifest',
};
export const MAX_EXPORT_BYTES = 10 * 1024 * 1024;
