import { BillingInterval, InvoiceStatus, Prisma } from '@prisma/client';
import { captureDescriptionTranslations, planDisplay } from './billing-display';
import { describeInvoice } from './billing-presenter';

const plan = { key: 'managed', name: 'Managed', interval: BillingInterval.MONTHLY,
  features: ['seating', 'custom-extra'], translations: { ru: { name: 'С организацией' }, en: { name: 'Managed' } } };

describe('billing display', () => {
  it('localizes labels while preserving feature keys and unknown custom labels', () => {
    expect(planDisplay(plan, 'ru')).toEqual({ locale: 'ru', name: 'С организацией', interval: 'ежемесячно',
      features: [{ key: 'seating', label: 'Рассадка' }, { key: 'custom-extra', label: 'custom-extra' }] });
  });

  it('does not replace a custom plan name using its stock key', () => {
    expect(planDisplay({ ...plan, name: 'Our own plan', translations: {} }, 'hy')).toMatchObject({ locale: null, name: 'Our own plan' });
  });

  it('captures translated descriptions independently of later plan edits', () => {
    const descriptions = captureDescriptionTranslations(plan);
    plan.translations.ru.name = 'Изменено';
    expect(descriptions.ru).toBe('С организацией (ежемесячно)');
    plan.translations.ru.name = 'С организацией';
  });

  it('keeps legacy invoice text and every financial field intact', () => {
    const line = { description: 'Legacy exact text', quantity: 1, unitPriceMinor: '9007199254740993', totalMinor: '9007199254740993', custom: 'kept' };
    const invoice = { id: 'invoice', number: 'AV-2026-000001', status: InvoiceStatus.PAID,
      subtotalMinor: 9007199254740993n, taxMinor: 0n, totalMinor: 9007199254740993n, currency: 'AMD',
      lines: [line] as Prisma.JsonValue, issuedAt: null, dueAt: null, paidAt: null, paymentOrderNumber: null };
    expect(describeInvoice(invoice, 'ru')).toMatchObject({ totalMinor: '9007199254740993', lines: [
      { ...line, display: { locale: null, description: 'Legacy exact text' } },
    ] });
  });

  it('uses captured invoice translations rather than any current plan wording', () => {
    const line = { description: 'Managed (monthly)', descriptionTranslations: { ru: 'С организацией (ежемесячно)' } };
    const invoice = { id: 'invoice', number: 'AV-1', status: InvoiceStatus.ISSUED, subtotalMinor: 1n,
      taxMinor: 0n, totalMinor: 1n, currency: 'AMD', lines: [line], issuedAt: null, dueAt: null, paidAt: null, paymentOrderNumber: null };
    expect(describeInvoice(invoice, 'ru').lines).toEqual([{ ...line, display: { locale: 'ru', description: line.descriptionTranslations.ru } }]);
  });
});
