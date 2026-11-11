import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
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

import { changeBooking } from '../api';
import { bookingChanges, bookingEditValues, currencyOf } from '../payload';
import { vendorRefusalOf, type VendorRefusal } from '../refusals';
import { bookingEditSchema, type BookingEditValues } from '../schemas';
import { CHOOSABLE_STATUSES } from '../scopes';
import type { Booking } from '../types';
import { ScopeFields } from './scope-fields';
import { CurrencyField, useFeeText, useFieldText, VendorProblem } from './shared';

function useCorrection(eventId: string, booking: Booking, page: PageActions) {
  const { t } = useTranslation('vendors');
  const [refusal, setRefusal] = useState<VendorRefusal | null>(null);
  const form = useForm<BookingEditValues>({
    resolver: zodResolver(bookingEditSchema),
    defaultValues: bookingEditValues(booking),
  });
  useLeaveGuard(form);
  const onSubmit = async (values: BookingEditValues) => {
    setRefusal(null);
    const changes = bookingChanges(booking, values);
    const hasChanges = Object.keys(changes).length > 0;
    try {
      if (hasChanges) {
        await changeBooking(browserSession().api, { eventId, bookingId: booking.id }, changes);
      }
      form.reset(values);
      await page.done(hasChanges ? t('status.saved') : t('status.unchanged'));
    } catch (error) {
      const found = vendorRefusalOf(error, 'change');
      if (found.kind === 'fields') {
        for (const field of found.fields)
          form.setError(field as keyof BookingEditValues, { message: 'refused' });
      }
      setRefusal(found);
      if (found.isStale) page.reload();
    }
  };
  return { form, refusal, onSubmit };
}

/** The fee and its currency, or for a role not shown the fee, that it isn't theirs to see. */
function FeeFields({
  booking,
  form,
}: {
  booking: Booking;
  form: UseFormReturn<BookingEditValues>;
}) {
  const { t } = useTranslation('vendors');
  const fieldText = useFieldText();
  const feeText = useFeeText();
  const { errors } = form.formState;
  if (!booking.fee.isShown) {
    return (
      <p className="m-0">{t('pair', { label: t('booking.fee'), value: feeText(booking.fee) })}</p>
    );
  }
  return (
    <>
      <TextInputField
        label={t('fee.label')}
        help={booking.fee.amountMinor === null ? t('fee.help') : t('fee.clearHelp')}
        inputMode="decimal"
        autoComplete="off"
        error={fieldText(errors.fee)}
        {...form.register('fee')}
      />
      <CurrencyField
        current={currencyOf(booking)}
        error={fieldText(errors.currency)}
        {...form.register('currency')}
      />
    </>
  );
}

/**
 * The booking's state, what the brief shares and the fee with its currency (design PD-122, PD-123).
 * Only what changed is sent; an emptied fee is removed, and a new currency goes with its amount
 * (FR-106). A role not shown the fee is told so, and no fee is sent for it.
 */
export function BookingForm({
  eventId,
  booking,
  page,
}: {
  eventId: string;
  booking: Booking;
  page: PageActions;
}) {
  const { t } = useTranslation('vendors');
  const headingId = useId();
  const fieldText = useFieldText();
  const { form, refusal, onSubmit } = useCorrection(eventId, booking, page);
  const { errors, isSubmitting } = form.formState;
  return (
    <section aria-labelledby={headingId} className="flex max-w-[34rem] flex-col gap-3">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('booking.formTitle')}
      </h2>
      {refusal ? <VendorProblem refusal={refusal} /> : null}
      <AppForm onSubmit={form.handleSubmit(onSubmit)}>
        <SelectField
          label={t('booking.status')}
          error={fieldText(errors.status)}
          {...form.register('status')}
        >
          {CHOOSABLE_STATUSES.map((status) => (
            <NativeSelectOption key={status} value={status}>
              {t(`statuses.${status}`)}
            </NativeSelectOption>
          ))}
        </SelectField>
        <ScopeFields control={form.control} name="scopes" help={t('booking.scopesHelp')} />
        <FeeFields booking={booking} form={form} />
        <SubmitButton
          isSubmitting={isSubmitting}
          className={`w-auto self-start ${WRAPPING_BUTTON}`}
        >
          {isSubmitting ? t('booking.saving') : t('booking.save')}
        </SubmitButton>
      </AppForm>
    </section>
  );
}
