import { PrismaClient } from '@prisma/client';
import { captureFreeTerms } from '../../src/modules/billing/scheduled-free';
import { planDisplay } from '../../src/modules/billing/billing-display';
import { seedBillingDisplay } from '../../src/seed/billing-display-sync';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('billing display seed and frozen free terms', () => {
  let prisma: PrismaClient;
  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());

  it('fills missing stock names without overwriting operator translations or repeating changes', async () => {
    const plan = await prisma.plan.create({ data: { key: 'managed', name: 'Managed', tier: 'MANAGED', priceMinor: 0n, interval: 'PER_EVENT',
      translations: { ru: { name: 'Наш тариф' } } } });
    expect(await seedBillingDisplay(prisma)).toBe(1);
    const stored = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(stored.translations).toMatchObject({ ru: { name: 'Наш тариф' }, en: { name: 'Managed' }, hy: { name: 'Կազմակերպմամբ' }, fr: { name: 'Accompagné' } });
    expect(await seedBillingDisplay(prisma)).toBe(0);
  });

  it('does not apply stock names to an operator-renamed plan sharing a stock key', async () => {
    const plan = await prisma.plan.create({ data: { key: 'managed', name: 'Custom agreement', tier: 'MANAGED', priceMinor: 0n, interval: 'PER_EVENT' } });
    expect(await seedBillingDisplay(prisma)).toBe(0);
    const stored = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
    expect(planDisplay(stored, 'ru')).toMatchObject({ locale: null, name: 'Custom agreement' });
  });

  it('freezes translated free-plan terms rather than using a later plan rename', async () => {
    const plan = await prisma.plan.create({ data: { key: 'free-custom', name: 'Free', tier: 'INVITATION', priceMinor: 0n, interval: 'PER_EVENT',
      translations: { ru: { name: 'Бесплатный' } } } });
    const terms = captureFreeTerms(plan);
    await prisma.plan.update({ where: { id: plan.id }, data: { translations: { ru: { name: 'Переименован' } } } });
    expect(planDisplay(terms, 'ru')).toMatchObject({ name: 'Бесплатный' });
    const { translations: _translations, ...legacy } = terms;
    expect(planDisplay(legacy, 'ru')).toMatchObject({ locale: null, name: 'Free' });
  });
});
