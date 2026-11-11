import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import {
  AppForm,
  SubmitButton,
  useLeaveGuard,
  WRAPPING_BUTTON,
  type PageActions,
} from '@/ui/app-form';

import { addVendor } from '../api';
import { NEW_VENDOR_VALUES, newVendorPayload } from '../payload';
import { vendorRefusalOf, type VendorRefusal } from '../refusals';
import { vendorFormSchema, type VendorFormOutput, type VendorFormValues } from '../schemas';
import { VendorProblem } from './shared';
import { markRefusedFields, VendorFields } from './vendor-fields';

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
      if (found.kind === 'fields') markRefusedFields(form, found.fields);
      setRefusal(found);
    }
  };
  return { form, refusal, onSubmit };
}

/** Adding a vendor to this organization, which alone sees it, with notes of its own (PD-120). */
export function AddVendorForm({ page }: { page: PageActions }) {
  const { t } = useTranslation('vendors');
  const headingId = useId();
  const { form, refusal, onSubmit } = useAdd(page);
  const { isSubmitting } = form.formState;
  return (
    <section aria-labelledby={headingId} className="flex max-w-[34rem] flex-col gap-3">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('add.title')}
      </h2>
      <p className="m-0">{t('add.lead')}</p>
      {refusal ? <VendorProblem refusal={refusal} /> : null}
      <AppForm onSubmit={form.handleSubmit(onSubmit)}>
        <VendorFields form={form} />
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
