import type { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { TextInputField } from '@/features/account';
import { NativeSelectOption } from '@/ui/kit/native-select';

import type { EventFormInput, EventFormValues } from '../schemas';
import { EVENT_TYPES } from '../types';
import { useEventFieldText } from '../use-field-text';
import { LanguageFields } from './language-fields';
import { SelectField } from './select-field';

export type EventForm = UseFormReturn<EventFormInput, unknown, EventFormValues>;

interface EventFieldsProps {
  form: EventForm;
  mode: 'create' | 'edit';
  /** The time zones to offer, the event's own included (`timeZoneOptions`). */
  zones: readonly string[];
  /** The languages to offer (`languageOptions`). */
  languages: readonly string[];
}

/** No type is chosen for a new event: "Choose…" stays until the host picks one (design PD-42). */
function TypeField({ form }: { form: EventForm }) {
  const { t } = useTranslation('events');
  const fieldText = useEventFieldText();
  return (
    <SelectField
      label={t('fields.type')}
      error={fieldText(form.formState.errors.type)}
      {...form.register('type')}
    >
      <NativeSelectOption value="">{t('types.choose')}</NativeSelectOption>
      {EVENT_TYPES.map((type) => (
        <NativeSelectOption key={type} value={type}>
          {t(`types.${type}`)}
        </NativeSelectOption>
      ))}
    </SelectField>
  );
}

/**
 * The date and time are typed in the event's own zone, with the browser's own inputs; `max` keeps
 * the year to four digits, as the API takes them. The zones are IANA names, as the API stores them.
 */
function WhenFields({ form, zones }: { form: EventForm; zones: readonly string[] }) {
  const { t } = useTranslation('events');
  const fieldText = useEventFieldText();
  const { errors } = form.formState;
  return (
    <>
      <div className="grid gap-5 min-[480px]:grid-cols-2">
        <TextInputField
          type="date"
          max="9999-12-31"
          label={t('fields.date')}
          error={fieldText(errors.date)}
          {...form.register('date')}
        />
        <TextInputField
          type="time"
          label={t('fields.time')}
          error={fieldText(errors.time)}
          {...form.register('time')}
        />
      </div>
      <SelectField
        label={t('fields.timezone')}
        help={t('fields.timezoneHelp')}
        error={fieldText(errors.timezone)}
        {...form.register('timezone')}
      >
        {zones.map((zone) => (
          <NativeSelectOption key={zone} value={zone}>
            {zone.replaceAll('_', ' ')}
          </NativeSelectOption>
        ))}
      </SelectField>
    </>
  );
}

/** The fields creating and correcting share, in the order a host thinks of them. */
export function EventFields({ form, mode, zones, languages }: EventFieldsProps) {
  const { t } = useTranslation('events');
  const fieldText = useEventFieldText();
  const { errors } = form.formState;
  return (
    <>
      <TypeField form={form} />
      <TextInputField
        label={t('fields.title')}
        help={t('fields.titleHelp')}
        error={fieldText(errors.title)}
        {...form.register('title')}
      />
      <TextInputField
        label={t('fields.hostsLabel')}
        help={mode === 'create' ? t('fields.hostsHelpNew') : t('fields.hostsHelp')}
        error={fieldText(errors.hostsLabel)}
        {...form.register('hostsLabel')}
      />
      <WhenFields form={form} zones={zones} />
      <LanguageFields form={form} options={languages} />
    </>
  );
}
