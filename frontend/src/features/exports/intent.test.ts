import { describe, expect, it } from 'vitest';

import { contactRuleOf, intentKey, intentOf, redactedOf, sameIntentOf } from './intent';
import { snapshot } from './test-data';
import { EXPORT_KINDS, type ExportKind } from './types';

const choices = (kind: ExportKind, withContacts: boolean) => ({
  kind,
  format: 'PDF' as const,
  locale: 'hy',
  withContacts,
});

describe('what an export asks for', () => {
  it('asks for email and phone on the guest list only when the host chose them', () => {
    expect(intentOf(choices('GUEST_LIST', true))).toEqual({
      kind: 'GUEST_LIST',
      format: 'PDF',
      locale: 'hy',
      includesContacts: true,
    });
    expect(intentOf(choices('GUEST_LIST', false)).includesContacts).toBe(false);
  });

  it.each(['SEATING_CHART', 'PLACE_CARDS', 'CATERING_SHEET', 'BAR_SHEET', 'PLAYLIST'] as const)(
    'makes a %s without contacts whatever the form held: it has no contact column (FR-60)',
    (kind) => {
      expect(contactRuleOf(kind)).toBe('none');
      expect(intentOf(choices(kind, true)).includesContacts).toBe(false);
    },
  );

  it('always asks for contacts on a ticket manifest, which cannot be redacted', () => {
    expect(contactRuleOf('TICKET_MANIFEST')).toBe('required');
    expect(intentOf(choices('TICKET_MANIFEST', false)).includesContacts).toBe(true);
    expect(contactRuleOf('GUEST_LIST')).toBe('choice');
  });

  it('gives every kind a rule', () => {
    expect(EXPORT_KINDS.map(contactRuleOf)).toEqual([
      'choice',
      'none',
      'none',
      'none',
      'none',
      'none',
      'required',
    ]);
  });

  it('makes a snapshot again exactly as it was asked for', () => {
    const made = snapshot({
      kind: 'SEATING_CHART',
      format: 'XLSX',
      locale: 'fr',
      includesContacts: true,
    });
    expect(sameIntentOf(made)).toEqual({
      kind: 'SEATING_CHART',
      format: 'XLSX',
      locale: 'fr',
      includesContacts: true,
    });
  });

  it('offers a copy without contacts, except of a ticket manifest', () => {
    const full = intentOf(choices('GUEST_LIST', true));
    expect(redactedOf(full)).toEqual({ ...full, includesContacts: false });
    expect(redactedOf(intentOf(choices('TICKET_MANIFEST', true)))).toBeNull();
  });

  it('names an intent the same way each time, and differently for any other choice', () => {
    const one = intentOf(choices('GUEST_LIST', true));
    expect(intentKey(one)).toBe(intentKey({ ...one }));
    expect(intentKey(one)).not.toBe(intentKey({ ...one, locale: 'en' }));
    expect(intentKey(one)).not.toBe(intentKey({ ...one, includesContacts: false }));
    expect(intentKey(one)).not.toBe(intentKey({ ...one, format: 'CSV' }));
  });
});
