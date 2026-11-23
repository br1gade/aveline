import { BillingInterval, Prisma } from '@prisma/client';
import { BILLING_LOCALES, BillingLocale, FEATURE_LABELS, INTERVAL_LABELS } from './billing-copy';

export interface DisplayPlan {
  key: string;
  name: string;
  interval: BillingInterval;
  features?: readonly string[];
  translations?: Prisma.JsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function billingLocale(locale: string): BillingLocale {
  return BILLING_LOCALES.find((language) => language === locale.toLowerCase().split('-')[0]) ?? 'en';
}

function translatedName(plan: DisplayPlan, locale: BillingLocale): string | null {
  const values = plan.translations;
  if (!isRecord(values)) return null;
  const translated = values[locale];
  if (!isRecord(translated) || typeof translated.name !== 'string' || !translated.name.trim()) return null;
  return translated.name;
}

export function planDisplay(plan: DisplayPlan, locale = 'en') {
  const language = billingLocale(locale);
  const name = translatedName(plan, language);
  return {
    locale: name === null ? null : language,
    name: name ?? plan.name,
    interval: INTERVAL_LABELS[language][plan.interval],
    features: (plan.features ?? []).map((key) => ({ key, label: FEATURE_LABELS[key]?.[language] ?? key })),
  };
}

/** Written into each new invoice line: later plan or copy edits cannot rewrite it. */
export function captureDescriptionTranslations(plan: DisplayPlan): Record<string, string> {
  return Object.fromEntries(BILLING_LOCALES.flatMap((locale) => {
    const name = translatedName(plan, locale);
    return name === null ? [] : [[locale, `${name} (${INTERVAL_LABELS[locale][plan.interval]})`]];
  }));
}

export function invoiceLinesDisplay(lines: Prisma.JsonValue, locale: string): Prisma.JsonValue {
  if (!Array.isArray(lines)) return lines;
  const language = billingLocale(locale);
  return lines.map((line) => {
    if (!isRecord(line) || typeof line.description !== 'string') return line;
    const values = line.descriptionTranslations;
    const translated = isRecord(values) ? values[language] : null;
    const hasTranslation = typeof translated === 'string' && translated.trim().length > 0;
    return { ...line, display: { locale: hasTranslation ? language : null, description: hasTranslation ? translated : line.description } };
  });
}
