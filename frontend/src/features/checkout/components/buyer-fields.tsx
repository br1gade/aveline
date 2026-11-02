import { useTranslation } from 'react-i18next';

import { TextField } from '@/ui/form';

import { LIMITS } from '../schemas';
import { fieldId, useCheckoutForm, useFieldError } from './checkout-context';

/** The buyer, apart from the people coming: the order and its emails go to them (docs/API.md §5). */
export function BuyerFields() {
  const { t } = useTranslation('checkout');
  const { register } = useCheckoutForm();
  const errors = {
    firstName: useFieldError('buyerFirstName'),
    lastName: useFieldError('buyerLastName'),
    email: useFieldError('buyerEmail'),
    phone: useFieldError('buyerPhone'),
  };
  return (
    <section aria-labelledby="buyer-heading" className="grid gap-5">
      <div className="grid gap-2">
        <h2 id="buyer-heading" className="type-heading-2 text-heading m-0">
          {t('buyer.heading')}
        </h2>
        <p className="text-text-muted m-0 text-sm">{t('buyer.lead')}</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          id={fieldId('buyerFirstName')}
          label={t('fields.firstName')}
          autoComplete="given-name"
          maxLength={LIMITS.name}
          error={errors.firstName}
          {...register('buyerFirstName')}
        />
        <TextField
          id={fieldId('buyerLastName')}
          label={t('fields.lastName')}
          optionalText={t('fields.optional')}
          autoComplete="family-name"
          maxLength={LIMITS.name}
          error={errors.lastName}
          {...register('buyerLastName')}
        />
      </div>
      <TextField
        id={fieldId('buyerEmail')}
        type="email"
        label={t('fields.email')}
        help={t('buyer.emailHelp')}
        autoComplete="email"
        maxLength={LIMITS.email}
        error={errors.email}
        {...register('buyerEmail')}
      />
      <TextField
        id={fieldId('buyerPhone')}
        type="tel"
        label={t('fields.phone')}
        optionalText={t('fields.optional')}
        autoComplete="tel"
        maxLength={LIMITS.phone}
        error={errors.phone}
        {...register('buyerPhone')}
      />
    </section>
  );
}
