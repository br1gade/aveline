import { BadRequestException } from '@nestjs/common';
import { webcrypto } from 'node:crypto';

export interface WhatsAppScope { accountId: string; phoneNumberId: string }
export type WhatsAppOutcome = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export interface NormalizedWhatsAppReceipt extends WhatsAppScope {
  receiptKey: string;
  providerRef: string;
  outcome: WhatsAppOutcome;
  occurredAt: Date;
  errorCode: number | null;
}
const OUTCOMES = new Map<string, WhatsAppOutcome>([['sent', 'SENT'], ['delivered', 'DELIVERED'], ['read', 'READ'], ['failed', 'FAILED']]);
const MAX_UPDATES = 1000;

export async function parseWhatsAppReceipts(input: unknown, scope: WhatsAppScope): Promise<NormalizedWhatsAppReceipt[]> {
  const body = requireObject(input);
  if (body.object !== 'whatsapp_business_account') throw new BadRequestException('Invalid WhatsApp object');
  const changes = collectChanges(body);
  const statuses: unknown[] = [];
  for (const change of changes) {
    const incoming = extractStatuses(change, scope);
    if (statuses.length + incoming.length > MAX_UPDATES) throw new BadRequestException('WhatsApp batch exceeds 1000 statuses');
    statuses.push(...incoming);
  }
  const normalized = statuses.map((status) => normalizeStatus(status, scope)).filter((row) => row !== null);
  return Promise.all(normalized.map(async (row) => {
    const identity = JSON.stringify([row.accountId, row.phoneNumberId, row.providerRef, row.outcome, row.occurredAt.getTime(), row.errorCode]);
    const receiptKey = Buffer.from(await webcrypto.subtle.digest('SHA-256', Buffer.from(identity))).toString('hex');
    return { ...row, receiptKey };
  }));
}

function collectChanges(body: Record<string, unknown>): { accountId: unknown; change: Record<string, unknown> }[] {
  const changes: { accountId: unknown; change: Record<string, unknown> }[] = [];
  for (const item of requireArray(body.entry)) {
    const entry = requireObject(item);
    const incoming = requireArray(entry.changes);
    if (changes.length + incoming.length > MAX_UPDATES) throw new BadRequestException('WhatsApp batch exceeds 1000 changes');
    changes.push(...incoming.map((change) => ({ accountId: entry.id, change: requireObject(change) })));
  }
  return changes;
}

function extractStatuses(input: { accountId: unknown; change: Record<string, unknown> }, scope: WhatsAppScope): unknown[] {
  if (input.accountId !== scope.accountId || input.change.field !== 'messages') return [];
  const value = requireObject(input.change.value);
  if (value.messaging_product !== 'whatsapp' || value.statuses === undefined) return [];
  const metadata = requireObject(value.metadata);
  if (metadata.phone_number_id !== scope.phoneNumberId) return [];
  return requireArray(value.statuses);
}

function normalizeStatus(input: unknown, scope: WhatsAppScope): Omit<NormalizedWhatsAppReceipt, 'receiptKey'> | null {
  const status = requireObject(input);
  const outcome = typeof status.status === 'string' ? OUTCOMES.get(status.status) : undefined;
  if (!outcome) return null; // Inbound and future provider features are outside this adapter's contract.
  if (typeof status.id !== 'string' || status.id.length === 0 || status.id.length > 512) throw new BadRequestException('Invalid WhatsApp status.id');
  return { ...scope, providerRef: status.id, outcome, occurredAt: requireTimestamp(status.timestamp), errorCode: requireErrorCode(status.errors) };
}

function requireTimestamp(timestamp: unknown): Date {
  if (typeof timestamp !== 'string' || !/^\d{1,10}$/.test(timestamp)) throw new BadRequestException('Invalid WhatsApp timestamp');
  const occurredAt = new Date(Number(timestamp) * 1000);
  if (occurredAt.getTime() > Date.now() + 300000) throw new BadRequestException('WhatsApp timestamp is in the future');
  return occurredAt;
}

function requireErrorCode(input: unknown): number | null {
  const errors = input === undefined ? [] : requireArray(input);
  const errorCode = errors.length ? requireObject(errors[0]).code : null;
  if (errorCode !== null && (typeof errorCode !== 'number' || !Number.isSafeInteger(errorCode) || errorCode < 0 || errorCode > 2147483647)) throw new BadRequestException('Invalid WhatsApp errors.code');
  return errorCode;
}

function requireObject(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BadRequestException('Invalid WhatsApp payload object');
  return input as Record<string, unknown>;
}
function requireArray(input: unknown): unknown[] {
  if (!Array.isArray(input) || input.length > MAX_UPDATES) throw new BadRequestException('WhatsApp arrays must contain at most 1000 items');
  return input as unknown[];
}
