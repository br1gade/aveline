import type { ExportFormat, ExportKind, Intent, Snapshot } from './types';

/** What the form holds; contacts are read only where the kind offers the choice. */
export interface ExportChoices {
  kind: ExportKind;
  format: ExportFormat;
  locale: string;
  withContacts: boolean;
}

/**
 * Whether a kind's file has email and phone: a choice for the guest list, always for the ticket
 * manifest (door codes and buyers' emails, which cannot be redacted), and never for the five
 * operational sheets, which have no contact column. A file asked for with contacts is refused once
 * contact access is lost, so those five go without and stay downloadable.
 *
 * **A temporary stand-in (FR-60):** this mirrors the backend's columns (`export-sheets.ts`), which
 * the API does not declare. Deleted when it does, or ignores `includesContacts` where it changes
 * nothing.
 */
export type ContactRule = 'choice' | 'required' | 'none';

const RULES: Readonly<Record<ExportKind, ContactRule>> = {
  GUEST_LIST: 'choice',
  SEATING_CHART: 'none',
  PLACE_CARDS: 'none',
  CATERING_SHEET: 'none',
  BAR_SHEET: 'none',
  PLAYLIST: 'none',
  TICKET_MANIFEST: 'required',
};

export function contactRuleOf(kind: ExportKind): ContactRule {
  return RULES[kind];
}

/** Every field is sent, so a retry's intent never depends on the backend's defaults. */
export function intentOf({ kind, format, locale, withContacts }: ExportChoices): Intent {
  const rule = contactRuleOf(kind);
  return {
    kind,
    format,
    locale,
    includesContacts: rule === 'required' || (rule === 'choice' && withContacts),
  };
}

/** Making a snapshot again asks for exactly what it asked for, with a new key. */
export function sameIntentOf({ kind, format, locale, includesContacts }: Snapshot): Intent {
  return { kind, format, locale, includesContacts };
}

/** The copy offered once contact access is gone; none for a ticket manifest. */
export function redactedOf(intent: Intent): Intent | null {
  return contactRuleOf(intent.kind) === 'required' ? null : { ...intent, includesContacts: false };
}

/** One string per intent, for the retry key: other choices are another request. */
export function intentKey({ kind, format, locale, includesContacts }: Intent): string {
  return [kind, format, locale, includesContacts ? 'contacts' : 'redacted'].join('/');
}
