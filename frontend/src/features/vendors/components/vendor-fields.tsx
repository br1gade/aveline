import { useId } from 'react';
import type { UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { ErrorLine, SelectField, TextInputField } from '@/ui/app-form';
import { Field, FieldDescription, FieldLabel } from '@/ui/kit/field';
import { NativeSelectOption } from '@/ui/kit/native-select';
import { Textarea } from '@/ui/kit/textarea';

import { NOTES_LIMIT, type VendorFormOutput, type VendorFormValues } from '../schemas';
import { VENDOR_CATEGORIES } from '../scopes';
import { useCategoryText, useFieldText } from './shared';

export type VendorForm = UseFormReturn<VendorFormValues, unknown, VendorFormOutput>;

function NotesField({ form }: { form: VendorForm }) {
  const { t } = useTranslation('vendors');
  const id = useId();
  const fieldText = useFieldText();
  const error = fieldText(form.formState.errors.notes);
  return (
    <Field data-invalid={error ? 'true' : undefined} className="gap-2">
      <FieldLabel htmlFor={id}>{t('add.notes')}</FieldLabel>
      <Textarea
        id={id}
        maxLength={NOTES_LIMIT}
        aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`}
        aria-invalid={error ? true : undefined}
        {...form.register('notes')}
      />
      <FieldDescription id={`${id}-help`}>{t('add.notesHelp')}</FieldDescription>
      {error ? <ErrorLine id={`${id}-error`}>{error}</ErrorLine> : null}
    </Field>
  );
}

/** A vendor's details, for adding one and for correcting one (design PD-120, FR-102). */
export function VendorFields({ form }: { form: VendorForm }) {
  const { t } = useTranslation('vendors');
  const fieldText = useFieldText();
  const categoryText = useCategoryText();
  const { errors } = form.formState;
  return (
    <>
      <TextInputField
        label={t('add.name')}
        autoComplete="organization"
        error={fieldText(errors.name)}
        {...form.register('name')}
      />
      <SelectField
        label={t('add.category')}
        error={fieldText(errors.category)}
        {...form.register('category')}
      >
        <NativeSelectOption value="">{t('add.chooseCategory')}</NativeSelectOption>
        {VENDOR_CATEGORIES.map((category) => (
          <NativeSelectOption key={category} value={category}>
            {categoryText(category)}
          </NativeSelectOption>
        ))}
      </SelectField>
      <TextInputField
        type="email"
        label={t('add.email')}
        help={t('add.optional')}
        autoComplete="email"
        error={fieldText(errors.email)}
        {...form.register('email')}
      />
      <TextInputField
        type="tel"
        label={t('add.phone')}
        help={t('add.optional')}
        autoComplete="tel"
        error={fieldText(errors.phone)}
        {...form.register('phone')}
      />
      <NotesField form={form} />
    </>
  );
}

/** The fields a 400 named, marked on the form. */
export function markRefusedFields(form: VendorForm, fields: readonly string[]): void {
  for (const field of fields)
    form.setError(field as keyof VendorFormValues, { message: 'refused' });
}
