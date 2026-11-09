import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/errors';

import { inventoryRefusalOf } from './inventory-refusals';

function refused(status: number, message = 'refused') {
  return new ApiError({
    status,
    messages: [message],
    requestId: 'r-1',
    feedback: { code: undefined, action: undefined, userMessage: undefined, details: [] },
  });
}

describe('a refused inventory or layout, in words (FR-6)', () => {
  it.each([
    [403, 'forbidden'],
    [404, 'gone'],
    [429, 'rateLimited'],
  ])('reads %i as %s', (status, kind) => {
    expect(inventoryRefusalOf(refused(status))).toEqual({ kind });
  });

  it.each([500, 0])('keeps the reference of a %i, which has no answer to show', (status) => {
    expect(inventoryRefusalOf(refused(status))).toEqual({ kind: 'noAnswer', requestId: 'r-1' });
  });

  it('asks for a reload only when the layout changed meanwhile', () => {
    expect(
      inventoryRefusalOf(refused(409, 'expectedVersion: the layout changed; reload it')),
    ).toEqual({ kind: 'changed' });
  });

  it.each([
    'key: this venue has reached its layout limit',
    'This show already has quantity-based orders',
    'Ticket inventory is already published for this show',
  ])('shows a 409 a reload can’t answer as it came: %s', (sentence) => {
    expect(inventoryRefusalOf(refused(409, sentence))).toEqual({
      kind: 'other',
      sentence,
      requestId: 'r-1',
    });
  });

  it('holds to the field the backend names on a stale layout', () => {
    const service = readFileSync(
      join(
        import.meta.dirname,
        '../../../../backend/src/modules/ticketing/venue-ticket-layouts.service.ts',
      ),
      'utf8',
    );
    expect(service).toContain("ConflictException('expectedVersion:");
  });

  it('keeps the sentence and reference of any other refusal', () => {
    expect(inventoryRefusalOf(refused(422, 'Not processable'))).toEqual({
      kind: 'other',
      sentence: 'Not processable',
      requestId: 'r-1',
    });
  });

  it('keeps the backend’s sentence for a 400, to show as it came', () => {
    expect(inventoryRefusalOf(refused(400, 'sections.0.rows: duplicate seat A1'))).toEqual({
      kind: 'invalid',
      sentence: 'sections.0.rows: duplicate seat A1',
    });
  });

  it('says an answer it couldn’t read is that, not the host’s mistake', () => {
    expect(inventoryRefusalOf(new TypeError('parse'))).toEqual({ kind: 'unreadable' });
  });
});
