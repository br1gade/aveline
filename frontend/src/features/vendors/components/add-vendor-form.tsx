import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import {
  AppForm,
  SelectField,
  SubmitButton,
  TextInputField,
  useLeaveGuard,
  WRAPPING_BUTTON,
  type PageActions,
} from '@/ui/app-form';
import { NativeSelectOption } from '@/ui/kit/native-select';

import { addVendor } from '../api';
import { NEW_VENDOR_VALUES, newVendorPayload } from '../payload';
import { vendorRefusalOf, type VendorRefusal } from '../refusals';
import { vendorFormSchema, type VendorFormOutput, type VendorFormValues } from '../schemas';
import { VENDOR_CATEGORIES } from '../scopes';
import { useCategoryText, useFieldText, VendorProblem } from './shared';

function useAdd(page: PageActions) {
  const { t } = useTranslation('vendors');
  const [refusal, setRefusal] = useState<VendorRefusal | null>(null);
  const form = useForm<VendorFormValues, unknown, VendorFormOutput>({
    resolver: zodResolver(vendorFormSchema),
    defaultValues: NEW_VENDOR_VALUES,
  });
  useLeaveGuard(form);
  const onSubmit = async (values: VendorFormOutput) => {
    setRefusal(null);
    try {
      await addVendor(browserSession().api, newVendorPayload(values));
      form.reset(NEW_VENDOR_VALUES);
      await page.done(t('status.added', { name: values.name }));
    } catch (error) {
      const found = vendorRefusalOf(error, 'add');
      if (found.kind === 'fields') {
        for (const field of found.fields) {
          form.setError(field as keyof VendorFormValues, { message: 'refused' });
        }
      }
      setRefusal(found);
    }
  };
  return { form, refusal, onSubmit };
}

/**
 * Adding a vendor to this organization, which alone sees it (design PD-120). Notes are left out:
 * the list never returns them, so a note typed here could never be read again (FR-102).
 */
export function AddVendorForm({ page }: { page: PageActions }) {
  const { t } = useTranslation('vendors');
  const headingId = useId();
  const fieldText = useFieldText();
  const categoryText = useCategoryText();
  const { form, refusal, onSubmit } = useAdd(page);
  const { errors, isSubmitting } = form.formState;
  return (
    <section aria-labelledby={headingId} className="flex max-w-[34rem] flex-col gap-3">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('add.title')}
      </h2>
      <p className="m-0">{t('add.lead')}</p>
      {refusal ? <VendorProblem refusal={refusal} /> : null}
      <AppForm onSubmit={form.handleSubmit(onSubmit)}>
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
        <SubmitButton
          isSubmitting={isSubmitting}
          className={`w-auto self-start ${WRAPPING_BUTTON}`}
        >
          {isSubmitting ? t('add.adding') : t('add.submit')}
        </SubmitButton>
      </AppForm>
    </section>
  );
}
