import { createContext, useContext } from 'react';
import { useFormContext, useFormState, type FieldPath } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { CheckoutRules, PublicEvent } from '@/features/public-event';

import type { CheckoutValues } from '../types';

/** What every part of the checkout form reads besides its values: the event and its rules. */
export interface CheckoutSetting {
  event: PublicEvent;
  rules: CheckoutRules;
  isBusy: boolean;
}

export const CheckoutContext = createContext<CheckoutSetting | null>(null);

export function useCheckoutSetting(): CheckoutSetting {
  const setting = useContext(CheckoutContext);
  if (!setting) throw new Error('A checkout part outside the checkout form');
  return setting;
}

export function useCheckoutForm() {
  return useFormContext<CheckoutValues>();
}

/** A field's id, for its label and for the error summary's link. */
export function fieldId(path: string): string {
  return `checkout-${path.replace(/\./g, '-')}`;
}

/** The field's message in words: our codes are worded here, anything else is a refusal. */
export function useFieldError(path: FieldPath<CheckoutValues>): string | undefined {
  const { t } = useTranslation('checkout');
  const { errors } = useFormState<CheckoutValues>({ name: path });
  const error = path
    .split('.')
    .reduce<unknown>(
      (node, key) =>
        typeof node === 'object' && node !== null
          ? (node as Record<string, unknown>)[key]
          : undefined,
      errors,
    );
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String(error.message)
      : undefined;
  return message ? t(`errors.${message}`, { defaultValue: t('errors.refused') }) : undefined;
}
