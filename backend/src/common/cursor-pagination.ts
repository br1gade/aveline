import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export interface CursorBoundary { at: Date | null; id: string }

interface StoredCursor { at: string | null; id: string; filtersDigest: string }

function filtersDigest(filters: object): string {
  return createHash('sha256').update(JSON.stringify(filters)).digest('hex');
}

/** A cursor is a position in these filters, never authorization to read its rows. */
export function readCursor(value: string | undefined, filters: object): CursorBoundary | null {
  if (!value) return null;
  try {
    const cursor: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!isStoredCursor(cursor) || cursor.filtersDigest !== filtersDigest(filters)) throw new Error();
    return { id: cursor.id, at: cursor.at === null ? null : new Date(cursor.at) };
  } catch {
    throw new BadRequestException('cursor: invalid for these filters');
  }
}

export function readDatedCursor(value: string | undefined, filters: object): { id: string; at: Date } | null {
  const cursor = readCursor(value, filters);
  if (!cursor) return null;
  if (cursor.at === null) throw new BadRequestException('cursor: invalid for these filters');
  return { id: cursor.id, at: cursor.at };
}

function isStoredCursor(value: unknown): value is StoredCursor {
  if (!value || typeof value !== 'object' || !('at' in value) || !('id' in value) || !('filtersDigest' in value)) return false;
  if (typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value.id)) return false;
  if (typeof value.filtersDigest !== 'string') return false;
  return value.at === null || isCanonicalDate(value.at);
}

function isCanonicalDate(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}

/** Queries fetch one extra row; the cursor belongs to the last row actually returned. */
export function cursorPage<T>(rows: T[], limit: number, filters: object, boundary: (row: T) => CursorBoundary) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  if (rows.length <= limit || last === undefined) return { items, nextCursor: null };
  const { id, at } = boundary(last);
  const cursor: StoredCursor = { id, at: at?.toISOString() ?? null, filtersDigest: filtersDigest(filters) };
  return { items, nextCursor: Buffer.from(JSON.stringify(cursor)).toString('base64url') };
}
