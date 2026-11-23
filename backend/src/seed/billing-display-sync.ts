import { Prisma, PrismaClient } from '@prisma/client';
import { BILLING_LOCALES, SEEDED_PLAN_NAMES } from '../modules/billing/billing-copy';

/** Fill missing names only for unchanged stock plans; operator wording remains authoritative. */
export async function seedBillingDisplay(prisma: PrismaClient): Promise<number> {
  let updated = 0;
  for (const stock of SEEDED_PLAN_NAMES) {
    const plan = await prisma.plan.findFirst({ where: { key: stock.key, name: stock.name }, select: { id: true, translations: true } });
    if (!plan) continue;
    const translations = plan.translations && typeof plan.translations === 'object' && !Array.isArray(plan.translations) ? plan.translations : {};
    const missing = BILLING_LOCALES.filter((locale) => translations[locale] === undefined);
    if (!missing.length) continue;
    const added = Object.fromEntries(missing.map((locale) => [locale, { name: stock.names[locale] }]));
    const written = await prisma.plan.updateMany({ where: { id: plan.id, translations: { equals: plan.translations ?? Prisma.JsonNull } }, data: { translations: { ...translations, ...added } } });
    updated += written.count;
  }
  return updated;
}
