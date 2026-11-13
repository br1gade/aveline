import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useRevalidator } from 'react-router';

import { browserSession } from '@/api/session';
import { bookingPath, eventVendorsPath } from '@/features/events';
import { APP_PATHS } from '@/route-paths';
import {
  AppForm,
  SelectField,
  SubmitButton,
  TextInputField,
  useLeaveGuard,
  WRAPPING_BUTTON,
} from '@/ui/app-form';
import { NativeSelectOptGroup, NativeSelectOption } from '@/ui/kit/native-select';

import { bookVendor } from '../api';
import type { NewBookingData } from '../load';
import { bookingPayload, DEFAULT_FEE_CURRENCY } from '../payload';
import { vendorRefusalOf, type VendorRefusal } from '../refusals';
import { bookingFormSchema, type BookingFormValues } from '../schemas';
import { VENDOR_CATEGORIES } from '../scopes';
import type { Booking, VendorCategory, VendorChoice, VendorChoices } from '../types';
import { ScopeFields } from './scope-fields';
import { CurrencyField, PageHeading, useCategoryText, useFieldText, VendorProblem } from './shared';

const NEW_BOOKING: BookingFormValues = {
  vendorId: '',
  scopes: [],
  fee: '',
  currency: DEFAULT_FEE_CURRENCY,
};

/** Each vendor's booking on this event, if any: an active one is opened, not posted again. */
function bookingsByVendor(bookings: NewBookingData['bookings']): ReadonlyMap<string, Booking> {
  const list = bookings.kind === 'ready' ? bookings.value : [];
  return new Map(list.map((booking) => [booking.vendor.id, booking]));
}

function byCategory(vendors: readonly VendorChoice[]): Array<[VendorCategory, VendorChoice[]]> {
  const grouped = new Map<VendorCategory, VendorChoice[]>();
  for (const vendor of vendors) {
    const group = grouped.get(vendor.category) ?? [];
    group.push(vendor);
    grouped.set(vendor.category, group);
  }
  return VENDOR_CATEGORIES.flatMap((category) => {
    const group = grouped.get(category);
    return group ? [[category, group] as [VendorCategory, VendorChoice[]]] : [];
  });
}

function VendorOptions({
  vendors,
  booked,
}: {
  vendors: readonly VendorChoice[];
  booked: ReadonlyMap<string, Booking>;
}) {
  const { t } = useTranslation('vendors');
  const categoryText = useCategoryText();
  return (
    <>
      <NativeSelectOption value="">{t('book.chooseVendor')}</NativeSelectOption>
      {byCategory(vendors).map(([category, group]) => (
        <NativeSelectOptGroup key={category} label={categoryText(category)}>
          {group.map((vendor) => {
            const booking = booked.get(vendor.id);
            const isActive = booking !== undefined && booking.status !== 'CANCELLED';
            const marks = [
              vendor.isCurated ? t('list.curated') : '',
              isActive ? t('book.alreadyBooked') : '',
              booking?.status === 'CANCELLED' ? t('book.ended') : '',
            ].filter(Boolean);
            return (
              <NativeSelectOption key={vendor.id} value={vendor.id} disabled={isActive}>
                {marks.length
                  ? t('book.option', { name: vendor.name, marks: marks.join(', ') })
                  : vendor.name}
              </NativeSelectOption>
            );
          })}
        </NativeSelectOptGroup>
      ))}
    </>
  );
}

function useBook(eventId: string, { choices, usualSections }: VendorChoices) {
  const { t } = useTranslation('vendors');
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  const [refusal, setRefusal] = useState<VendorRefusal | null>(null);
  const form = useForm<BookingFormValues>({
    resolver: zodResolver(bookingFormSchema),
    defaultValues: NEW_BOOKING,
  });
  useLeaveGuard(form);
  const categories = useMemo(
    () => new Map(choices.map((choice) => [choice.id, choice.category])),
    [choices],
  );
  // The backend's own usual set for the kind chosen (FR-105); the form then sends what is ticked.
  const presetSections = (vendorId: string) => {
    const category = categories.get(vendorId);
    const usual = category ? usualSections.get(category) : undefined;
    form.setValue('scopes', usual ? [...usual] : [], { shouldDirty: true });
  };
  const onSubmit = async (values: BookingFormValues) => {
    setRefusal(null);
    try {
      const bookingId = await bookVendor(browserSession().api, eventId, bookingPayload(values));
      form.reset(values);
      await navigate(bookingPath(eventId, bookingId), { state: { status: t('status.booked') } });
    } catch (error) {
      const found = vendorRefusalOf(error, 'book');
      if (found.kind === 'fields') {
        for (const field of found.fields)
          form.setError(field as keyof BookingFormValues, { message: 'refused' });
      }
      setRefusal(found);
      if (found.isStale) void revalidate();
    }
  };
  return { form, refusal, onSubmit, presetSections };
}

const ADD_LINK =
  'text-action inline-flex min-h-11 items-center self-start underline decoration-1 underline-offset-3';

/** Where a vendor not on the list is added: the organization's own vendors (design PD-121). */
function AddVendorLink({ children }: { children: string }) {
  return (
    <Link to={APP_PATHS.vendors} className={ADD_LINK}>
      {children}
    </Link>
  );
}

/** Nothing to choose from: no vendor of the organization's own and none on Aveline's list. */
function NothingToChoose() {
  const { t } = useTranslation('vendors');
  return (
    <div className="flex max-w-[34rem] flex-col gap-2">
      <p className="m-0">{t('book.none')}</p>
      <AddVendorLink>{t('book.addFirst')}</AddVendorLink>
    </div>
  );
}

function BookForm({
  eventId,
  choices,
  booked,
}: {
  eventId: string;
  choices: VendorChoices;
  booked: ReadonlyMap<string, Booking>;
}) {
  const { t } = useTranslation('vendors');
  const fieldText = useFieldText();
  const { form, refusal, onSubmit, presetSections } = useBook(eventId, choices);
  const { errors, isSubmitting } = form.formState;
  const vendorField = form.register('vendorId', {
    onChange: (change: { target: { value: string } }) => presetSections(change.target.value),
  });
  return (
    <>
      {refusal ? <VendorProblem refusal={refusal} /> : null}
      <AppForm onSubmit={form.handleSubmit(onSubmit)} className="max-w-[34rem]">
        <SelectField
          label={t('book.vendor')}
          help={t('book.vendorHelp')}
          error={fieldText(errors.vendorId)}
          {...vendorField}
        >
          <VendorOptions vendors={choices.choices} booked={booked} />
        </SelectField>
        <AddVendorLink>{t('book.notListed')}</AddVendorLink>
        <ScopeFields control={form.control} name="scopes" help={t('book.scopesHelp')} />
        <TextInputField
          label={t('fee.label')}
          help={t('fee.help')}
          inputMode="decimal"
          autoComplete="off"
          error={fieldText(errors.fee)}
          {...form.register('fee')}
        />
        <CurrencyField
          current={DEFAULT_FEE_CURRENCY}
          error={fieldText(errors.currency)}
          {...form.register('currency')}
        />
        <SubmitButton
          isSubmitting={isSubmitting}
          className={`w-auto self-start ${WRAPPING_BUTTON}`}
        >
          {isSubmitting ? t('book.booking') : t('book.submit')}
        </SubmitButton>
      </AppForm>
    </>
  );
}

/**
 * Booking a vendor for this event (docs/API.md §6; design PD-121): one of the organization's own
 * or of Aveline's list, as the event's own choices give them to anyone who may read its vendors
 * (FR-103), the sections their brief shares, preset to the backend's usual set for their kind
 * (FR-105) and always sent as ticked, and the fee in the currency chosen (FR-106). A vendor already
 * booked is changed on their booking's page, since booking them again would replace it.
 */
export function BookVendorPage({ data }: { data: NewBookingData }) {
  const { t } = useTranslation('vendors');
  const { event, choices } = data;
  const booked = useMemo(() => bookingsByVendor(data.bookings), [data.bookings]);
  return (
    <section className="flex flex-col gap-6">
      <PageHeading
        back={eventVendorsPath(event.id)}
        backLabel={t('backBookings')}
        title={t('book.title')}
        subtitle={event.title}
      />
      <p className="m-0 max-w-[40rem]">{t('book.lead')}</p>
      {choices.kind === 'ready' && choices.value.choices.length === 0 ? <NothingToChoose /> : null}
      {choices.kind === 'ready' && choices.value.choices.length > 0 ? (
        <BookForm eventId={event.id} choices={choices.value} booked={booked} />
      ) : null}
      {choices.kind === 'ready' ? null : <VendorProblem refusal={choices.refusal} />}
    </section>
  );
}
