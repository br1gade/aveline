import type { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { useLanguageName } from '@/lib/i18n';
import { SelectField, TextInputField, TranslationFields } from '@/ui/app-form';
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
 * The name and address in each of the event's other languages (design PD-109). Guests reading one
 * see its words here, else the plain name and address: the backend has no step between.
 */
function VenueTranslations({
  form,
  languages,
  defaultLocale,
}: {
  form: VenueForm;
  languages: readonly string[];
  defaultLocale: string;
}) {
  const { t } = useTranslation('venues');
  const languageName = useLanguageName();
  const fieldText = useVenueFieldText();
  const { errors } = form.formState;
  if (languages.length === 0) return null;
  return (
    <TranslationFields
      legend={t('fields.otherLanguages')}
      help={t('fields.otherLanguagesHelp')}
      languages={languages}
      languageName={languageName}
      fields={[
        { key: 'name' as const, label: (language) => t('fields.nameIn', { language }) },
        { key: 'address' as const, label: (language) => t('fields.addressIn', { language }) },
      ]}
      inputProps={(language, field) => form.register(`translations.${language}.${field}`)}
      errorOf={(language, field) => fieldText(errors.translations?.[language]?.[field])}
      noteOf={(language) =>
        language === defaultLocale
          ? t('fields.defaultOverride', { language: languageName(language) })
          : undefined
      }
      error={fieldText(errors.translations)}
    />
  );
}

interface VenueFieldsProps {
  form: VenueForm;
  timeZone: string;
  /** The event's languages the venue's words are typed in, besides the plain ones. */
  languages?: readonly string[] | undefined;
  defaultLocale?: string | undefined;
}

/**
 * The fields adding and correcting share (design PD-46). No coordinates: the guest page gives
 * directions through the map link (R-19). No role is chosen for a new venue.
 */
export function VenueFields({
  form,
  timeZone,
  languages = [],
  defaultLocale = '',
}: VenueFieldsProps) {
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
      <VenueTranslations form={form} languages={languages} defaultLocale={defaultLocale} />
    </>
  );
}
