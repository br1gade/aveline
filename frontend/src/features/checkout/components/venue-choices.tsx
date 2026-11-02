import { Controller } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { Fieldset, Segmented } from '@/ui/form';

import type { VenueStatus } from '../types';
import { fieldId, useCheckoutForm, useCheckoutSetting, useFieldError } from './checkout-context';

const STATUSES: readonly VenueStatus[] = ['ATTENDING', 'DECLINED', 'UNDECIDED'];

/**
 * In PER_VENUE, this person's own answer at each venue guests see, none chosen at first; at least
 * one is needed, and the ones left are pending (docs/API.md §5, design PD-79).
 */
export function VenueChoices({ index, name }: { index: number; name: string }) {
  const { t } = useTranslation('checkout');
  const { control } = useCheckoutForm();
  const { rules } = useCheckoutSetting();
  const path = `people.${index}.venues` as const;
  const error = useFieldError(path);
  if (rules.attendanceMode !== 'PER_VENUE') return null;
  const options = STATUSES.map((status) => ({ value: status, label: t(`venue.${status}`) }));
  return (
    <Fieldset id={fieldId(path)} legend={t('venue.legend')} error={error}>
      <p className="text-text-muted m-0 text-sm">{t('venue.lead')}</p>
      {rules.venues.map((venue) => (
        <Controller
          key={venue.id}
          control={control}
          name={`people.${index}.venues.${venue.id}`}
          render={({ field }) => (
            <Segmented
              legend={t('venue.at', { name, venue: venue.name })}
              name={`${path}.${venue.id}`}
              value={field.value ?? ''}
              options={options}
              onChange={field.onChange}
            />
          )}
        />
      ))}
    </Fieldset>
  );
}
