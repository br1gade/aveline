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
import { bookingPayload, FEE_CURRENCY } from '../payload';
import { vendorRefusalOf, type VendorRefusal } from '../refusals';
import { bookingFormSchema, type BookingFormValues } from '../schemas';
import { usualSectionsFor, VENDOR_CATEGORIES } from '../scopes';
import type { Booking, Vendor, VendorCategory } from '../types';
import { ScopeFields } from './scope-fields';
import { BACK_LINK, PageHeading, useCategoryText, useFieldText, VendorProblem } from './shared';

const NEW_BOOKING: BookingFormValues = { vendorId: '', scopes: [], fee: '' };

/** Each vendor's booking on this event, if any: an active one is opened, not posted again. */
function bookingsByVendor(bookings: NewBookingData['bookings']): ReadonlyMap<string, Booking> {
  const list = bookings.kind === 'ready' ? bookings.value : [];
  return new Map(list.map((booking) => [booking.vendor.id, booking]));
}

function byCategory(vendors: readonly Vendor[]): Array<[VendorCategory, Vendor[]]> {
  const grouped = new Map<VendorCategory, Vendor[]>();
  for (const vendor of vendors) {
    const group = grouped.get(vendor.category) ?? [];
    group.push(vendor);
    grouped.set(vendor.category, group);
  }
  return VENDOR_CATEGORIES.flatMap((category) => {
    const group = grouped.get(category);
    return group ? [[category, group] as [VendorCategory, Vendor[]]] : [];
  });
}

function VendorOptions({
  vendors,
  booked,
}: {
  vendors: readonly Vendor[];
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

function useBook(eventId: string, vendors: readonly Vendor[]) {
  const { t } = useTranslation('vendors');
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  const [refusal, setRefusal] = useState<VendorRefusal | null>(null);
  const schema = useMemo(() => bookingFormSchema(FEE_CURRENCY), []);
  const form = useForm<BookingFormValues>({
    resolver: zodResolver(schema),
    defaultValues: NEW_BOOKING,
  });
  useLeaveGuard(form);
  const categories = useMemo(
    () => new Map(vendors.map((vendor) => [vendor.id, vendor.category])),
    [vendors],
  );
  const presetSections = (vendorId: string) => {
    const category = categories.get(vendorId);
    form.setValue('scopes', category ? usualSectionsFor(category) : [], { shouldDirty: true });
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

function BookForm({
  eventId,
  vendors,
  booked,
}: {
  eventId: string;
  vendors: readonly Vendor[];
  booked: ReadonlyMap<string, Booking>;
}) {
  const { t } = useTranslation('vendors');
  const fieldText = useFieldText();
  const { form, refusal, onSubmit, presetSections } = useBook(eventId, vendors);
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
          <VendorOptions vendors={vendors} booked={booked} />
        </SelectField>
        <ScopeFields control={form.control} name="scopes" help={t('book.scopesHelp')} />
        <TextInputField
          label={t('fee.label')}
          help={t('fee.help')}
          inputMode="numeric"
          autoComplete="off"
          error={fieldText(errors.fee)}
          {...form.register('fee')}
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
 * or of Aveline's list, the sections their brief shares, preset to the usual set for their kind
 * (FR-105's stand-in) and always sent as ticked, and the fee in AMD (FR-106). A vendor already
 * booked is changed on their booking's page, since booking them again would replace it.
 */
export function BookVendorPage({ data }: { data: NewBookingData }) {
  const { t } = useTranslation('vendors');
  const { event, vendors } = data;
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
      {vendors.kind === 'ready' ? (
        <BookForm eventId={event.id} vendors={vendors.value} booked={booked} />
      ) : (
        <>
          <VendorProblem refusal={vendors.refusal} />
          <Link to={APP_PATHS.vendors} className={BACK_LINK}>
            {t('book.organization')}
          </Link>
        </>
      )}
    </section>
  );
}
