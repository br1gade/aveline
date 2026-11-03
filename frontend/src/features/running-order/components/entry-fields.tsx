import { useId } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { useLanguageName } from '@/lib/i18n';
import { ErrorLine, SelectField, TextInputField } from '@/ui/app-form';
import { Checkbox } from '@/ui/kit/checkbox';
import { Label } from '@/ui/kit/label';
import { NativeSelectOption } from '@/ui/kit/native-select';

import type { EntryFieldCode, EntryFormValues } from '../schemas';
import type { OrderVenue } from '../types';

export type EntryForm = UseFormReturn<EntryFormValues>;

function useErrorText() {
  const { t } = useTranslation('running-order');
  return (error: { message?: string | undefined } | undefined) =>
    error?.message ? t(`errors.${error.message as EntryFieldCode}`) : undefined;
}

/** A name in each language, each field marked as that language for a screen reader. */
function NameFields({ form, languages }: { form: EntryForm; languages: readonly string[] }) {
  const { t } = useTranslation('running-order');
  const languageName = useLanguageName();
  const errorText = useErrorText();
  const id = useId();
  const error = errorText(form.formState.errors.labels);
  return (
    <fieldset
      className="m-0 flex flex-col gap-3 border-0 p-0"
      aria-describedby={error ? `${id}-error` : `${id}-help`}
    >
      <legend className="mb-1 p-0 text-sm font-medium">{t('dialog.names')}</legend>
      <p id={`${id}-help`} className="text-muted-foreground m-0 text-sm">
        {t('dialog.namesHelp')}
      </p>
      {languages.map((code) => (
        <TextInputField
          key={code}
          label={languageName(code)}
          lang={code}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          {...form.register(`labels.${code}`)}
        />
      ))}
      {error ? <ErrorLine id={`${id}-error`}>{error}</ErrorLine> : null}
    </fieldset>
  );
}

function TeamOnlyField({ form }: { form: EntryForm }) {
  const { t } = useTranslation('running-order');
  const id = useId();
  return (
    <Controller
      control={form.control}
      name="isInternal"
      render={({ field }) => (
        <div className="flex min-h-11 items-start gap-3">
          <Checkbox
            id={id}
            ref={field.ref}
            className="mt-1"
            checked={field.value}
            onCheckedChange={(checked) => field.onChange(checked === true)}
            aria-describedby={`${id}-help`}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor={id} className="leading-snug font-normal">
              {t('dialog.internal')}
            </Label>
            <span id={`${id}-help`} className="text-muted-foreground text-sm">
              {t('dialog.internalHelp')}
            </span>
          </div>
        </div>
      )}
    />
  );
}

interface EntryFieldsProps {
  form: EntryForm;
  languages: readonly string[];
  venues: readonly OrderVenue[];
  timeZone: string;
}

/** The fields adding and correcting share (design PD-106). */
export function EntryFields({ form, languages, venues, timeZone }: EntryFieldsProps) {
  const { t } = useTranslation('running-order');
  const errorText = useErrorText();
  const { errors } = form.formState;
  return (
    <>
      <NameFields form={form} languages={languages} />
      <div className="grid gap-5 min-[480px]:grid-cols-2">
        <TextInputField
          type="date"
          max="9999-12-31"
          label={t('dialog.date')}
          error={errorText(errors.date)}
          {...form.register('date')}
        />
        <TextInputField
          type="time"
          label={t('dialog.time')}
          help={t('dialog.timeHelp', { timeZone: timeZone.replaceAll('_', ' ') })}
          error={errorText(errors.time)}
          {...form.register('time')}
        />
      </div>
      <SelectField label={t('dialog.venue')} {...form.register('venueId')}>
        <NativeSelectOption value="">{t('dialog.noVenue')}</NativeSelectOption>
        {venues.map((venue) => (
          <NativeSelectOption key={venue.id} value={venue.id}>
            {venue.name}
          </NativeSelectOption>
        ))}
      </SelectField>
      <TeamOnlyField form={form} />
    </>
  );
}
