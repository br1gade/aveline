import { BillingInterval } from '@prisma/client';

export const BILLING_LOCALES = ['en', 'hy', 'ru', 'fr'] as const;
export type BillingLocale = (typeof BILLING_LOCALES)[number];

export const INTERVAL_LABELS: Record<BillingLocale, Record<BillingInterval, string>> = {
  en: { MONTHLY: 'monthly', YEARLY: 'yearly', PER_EVENT: 'per event' },
  hy: { MONTHLY: 'ամսական', YEARLY: 'տարեկան', PER_EVENT: 'մեկ միջոցառման համար' },
  ru: { MONTHLY: 'ежемесячно', YEARLY: 'ежегодно', PER_EVENT: 'за мероприятие' },
  fr: { MONTHLY: 'par mois', YEARLY: 'par an', PER_EVENT: 'par événement' },
};

export const FEATURE_LABELS: Record<string, Record<BillingLocale, string>> = {
  seating: { en: 'Seating', hy: 'Նստեցում', ru: 'Рассадка', fr: 'Placement des invités' },
  'check-in': { en: 'Check-in', hy: 'Հյուրերի գրանցում', ru: 'Регистрация гостей', fr: 'Accueil des invités' },
  operations: { en: 'Event operations', hy: 'Միջոցառման կազմակերպում', ru: 'Проведение мероприятия', fr: 'Organisation de l’événement' },
  'vendor-briefs': { en: 'Vendor briefs', hy: 'Հանձնարարություններ մատակարարներին', ru: 'Задания подрядчикам', fr: 'Consignes aux prestataires' },
  'thank-yous': { en: 'Thank-you messages', hy: 'Շնորհակալական հաղորդագրություններ', ru: 'Благодарственные сообщения', fr: 'Messages de remerciement' },
  'custom-design': { en: 'Custom design', hy: 'Անհատական դիզայն', ru: 'Индивидуальный дизайн', fr: 'Design personnalisé' },
  coordinator: { en: 'Coordinator', hy: 'Համակարգող', ru: 'Координатор', fr: 'Coordination' },
};

export const SEEDED_PLAN_NAMES = [
  { key: 'invitation-free', name: 'Invitation', names: { en: 'Invitation', hy: 'Հրավեր', ru: 'Приглашение', fr: 'Invitation' } },
  { key: 'managed', name: 'Managed', names: { en: 'Managed', hy: 'Կազմակերպմամբ', ru: 'С организацией', fr: 'Accompagné' } },
  { key: 'production', name: 'Production', names: { en: 'Production', hy: 'Ամբողջական կազմակերպում', ru: 'Полная организация', fr: 'Organisation complète' } },
  { key: 'planner-monthly', name: 'Planner', names: { en: 'Planner', hy: 'Կազմակերպիչ', ru: 'Организатор', fr: 'Organisateur' } },
] as const;
