import { useTranslation } from 'react-i18next';

import { isLanguage } from '@/lib/i18n';
import { formatEventDay, formatEventTime } from '@/lib/time';

import { contactRuleOf } from '../intent';
import type { ExportFormat, ExportKind, Intent } from '../types';

export interface ExportText {
  kind: (kind: ExportKind) => string;
  format: (format: ExportFormat) => string;
  /** A language in its own name; a code the interface does not offer, as it came. */
  language: (code: string) => string;
  /** "Guest list (PDF)": what an export is, in a sentence or a button's name. */
  what: (intent: Intent) => string;
  /** "Հայերեն · with contact details": the rest of what was asked for. */
  details: (intent: Intent) => string;
  /** A moment in the event's own zone, never the device's: "30 October 2026, 14:05". */
  moment: (iso: string) => string;
}

/** The words for an export, shared by the form, the list, the status line and the refusals. */
export function useExportText(timeZone: string): ExportText {
  const { t, i18n } = useTranslation('exports');
  const { t: common } = useTranslation('common');
  const kind = (value: ExportKind) => t(`kinds.${value}.name`);
  const format = (value: ExportFormat) => t(`formats.${value}.short`);
  const language = (code: string) => (isLanguage(code) ? common(`language.${code}`) : code);
  const contacts = (intent: Intent) => {
    if (intent.includesContacts) return t('contacts.with');
    return contactRuleOf(intent.kind) === 'choice' ? t('contacts.without') : '';
  };
  const zone = { timeZone, locale: i18n.language };
  return {
    kind,
    format,
    language,
    what: (intent) => t('what', { kind: kind(intent.kind), format: format(intent.format) }),
    details: (intent) => [language(intent.locale), contacts(intent)].filter(Boolean).join(' · '),
    moment: (iso) => `${formatEventDay(iso, zone)}, ${formatEventTime(iso, zone)}`,
  };
}
