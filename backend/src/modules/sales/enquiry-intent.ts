import { BadRequestException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface IntentKeyring { current: string; keys: Record<string, string> }

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(normalizeField(key, item))]));
}

export function intentFingerprint(intent: unknown, keyring: IntentKeyring, keyId = keyring.current): string {
  const key = keyring.keys[keyId];
  if (!key) throw new Error('Missing retained intake intent key');
  const digest = createHmac('sha256', key).update(JSON.stringify(canonical(intent))).digest('hex');
  return `${keyId}:${digest}`;
}

export function sameIntent(fingerprint: string | null, intent: unknown, keyring: IntentKeyring): boolean {
  if (!fingerprint) return false;
  const keyId = fingerprint.split(':')[0];
  if (!keyring.keys[keyId]) return false;
  const expected = Buffer.from(intentFingerprint(intent, keyring, keyId));
  const received = Buffer.from(fingerprint);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function validateIdempotencyKey(key: string | undefined): string {
  if (!key || !/^[\x21-\x7e][\x20-\x7e]{7,127}$/.test(key)) throw new BadRequestException('Idempotency-Key must be 8–128 printable ASCII characters');
  return key;
}

function normalizeField(key: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (['email', 'ownerEmail'].includes(key)) return value.trim().toLowerCase();
  if (['startsAt', 'endsAt'].includes(key) && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  return value;
}
