import type { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { SelectField, TextInputField } from '@/ui/app-form';
import { NativeSelectOption } from '@/ui/kit/native-select';

import type { VenueFormInput, VenueFormValues } from '../schemas';
import { VENUE_ROLES } from '../types';
import { useVenueFieldText } from '../use-field-text';

export type VenueForm = UseFormReturn<VenueFormInput, unknown, VenueFormValues>;

/**
 * When guests should arrive, typed in the event's own zone with the browser's own inputs (design
 * PD-42, PD-43); `max` keeps the year to four digits, as the API takes them. Both or neither.
 */
function ArrivalFields({ form, timeZone }: { form: VenueForm; timeZone: string }) {
  const { t } = useTranslation('venues');
  const fieldText = useVenueFieldText();
  const { errors } = form.formState;
  return (
    <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
      <legend className="mb-1 p-0 text-sm font-medium">{t('fields.arrival')}</legend>
      <p className="text-muted-foreground m-0 text-sm">
        {t('fields.arrivalHelp', { timeZone: timeZone.replaceAll('_', ' ') })}
      </p>
      <div className="grid gap-5 min-[480px]:grid-cols-2">
        <TextInputField
          type="date"
          max="9999-12-31"
          label={t('fields.arrivalDate')}
          error={fieldText(errors.arrivalDate)}
          {...form.register('arrivalDate')}
        />
        <TextInputField
          type="time"
          label={t('fields.arrivalTime')}
          error={fieldText(errors.arrivalTime)}
          {...form.register('arrivalTime')}
        />
      </div>
    </fieldset>
  );
}

/**
 * The fields adding and correcting share (design PD-46). No coordinates: the guest page gives
 * directions through the map link (R-19). No role is chosen for a new venue.
 */
export function VenueFields({ form, timeZone }: { form: VenueForm; timeZone: string }) {
  const { t } = useTranslation('venues');
  const fieldText = useVenueFieldText();
  const { errors } = form.formState;
  return (
    <>
      <SelectField
        label={t('fields.role')}
        help={t('fields.roleHelp')}
        error={fieldText(errors.role)}
        {...form.register('role')}
      >
        <NativeSelectOption value="">{t('roles.choose')}</NativeSelectOption>
        {VENUE_ROLES.map((role) => (
          <NativeSelectOption key={role} value={role}>
            {t(`roles.${role}`)}
          </NativeSelectOption>
        ))}
      </SelectField>
      <TextInputField
        label={t('fields.name')}
        help={t('fields.nameHelp')}
        autoComplete="off"
        error={fieldText(errors.name)}
        {...form.register('name')}
      />
      <TextInputField
        label={t('fields.address')}
        help={t('fields.addressHelp')}
        autoComplete="off"
        error={fieldText(errors.address)}
        {...form.register('address')}
      />
      <TextInputField
        type="url"
        inputMode="url"
        label={t('fields.mapUrl')}
        help={t('fields.mapUrlHelp')}
        autoComplete="off"
        error={fieldText(errors.mapUrl)}
        {...form.register('mapUrl')}
      />
      <ArrivalFields form={form} timeZone={timeZone} />
    </>
  );
}
