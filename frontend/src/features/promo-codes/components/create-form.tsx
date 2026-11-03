import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useMemo, useState } from 'react';
import { Controller, useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import type { EventSummary } from '@/features/events';
import {
  AppForm,
  SelectField,
  SubmitButton,
  TextInputField,
  WRAPPING_BUTTON,
  type PageActions,
} from '@/ui/app-form';
import { Label } from '@/ui/kit/label';
import { NativeSelectOption } from '@/ui/kit/native-select';
import { RadioGroup, RadioGroupItem } from '@/ui/kit/radio-group';

import { createPromoCode } from '../api';
import { NEW_PROMO_VALUES, newPromoPayload } from '../payload';
import {
  isFieldRefusal,
  promoRefusalOf,
  REFUSAL_FIELD,
  zoneFor,
  type PromoRefusal,
} from '../rules';
import { promoFormSchema, type PromoFieldCode, type PromoFormValues } from '../schemas';
import { PromoProblem } from './shared';

type PromoForm = UseFormReturn<PromoFormValues>;

const FIELD_CODES: readonly string[] = [
  'required',
  'codeShort',
  'codeChars',
  'tooLong',
  'percent',
  'amount',
  'limit',
  'pair',
  'dateInvalid',
  'timeSkipped',
  'untilBefore',
  'belowUsed',
  'cantClear',
] satisfies PromoFieldCode[];

/** A field's error: the form's own code, or the server's refusal of that field, in its words. */
function useFieldText() {
  const { t } = useTranslation('promo-codes');
  return (error: { message?: unknown } | undefined) => {
    const code = error?.message;
    if (typeof code !== 'string') return undefined;
    if (FIELD_CODES.includes(code)) return t(`errors.${code as PromoFieldCode}`);
    return isFieldRefusal(code) ? t(`refused.${code}`) : t('errors.refused');
  };
}

function KindChoices({ form }: { form: PromoForm }) {
  const { t } = useTranslation('promo-codes');
  const id = useId();
  return (
    <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
      <legend id={`${id}-legend`} className="mb-1 p-0 text-sm font-medium">
        {t('create.kind')}
      </legend>
      <Controller
        control={form.control}
        name="kind"
        render={({ field }) => (
          <RadioGroup
            aria-labelledby={`${id}-legend`}
            value={field.value}
            onValueChange={(next) => field.onChange(next === 'FIXED' ? 'FIXED' : 'PERCENT')}
            className="gap-1"
          >
            {(['PERCENT', 'FIXED'] as const).map((kind) => (
              <div key={kind} className="flex min-h-11 items-center gap-3">
                <RadioGroupItem value={kind} id={`${id}-${kind}`} />
                <Label htmlFor={`${id}-${kind}`} className="font-normal">
                  {t(`create.kinds.${kind}`)}
                </Label>
              </div>
            ))}
          </RadioGroup>
        )}
      />
    </fieldset>
  );
}

/** A start or an end, typed in the zone the page names. */
function MomentFields({
  form,
  which,
  zone,
}: {
  form: PromoForm;
  which: 'from' | 'until';
  zone: string;
}) {
  const { t } = useTranslation('promo-codes');
  const fieldText = useFieldText();
  const { errors } = form.formState;
  const [date, time] =
    which === 'from' ? (['fromDate', 'fromTime'] as const) : (['untilDate', 'untilTime'] as const);
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend className="mb-1 p-0 text-sm font-medium">{t(`create.${which}`)}</legend>
      <p className="text-muted-foreground m-0 text-sm">
        {t('create.zoneHelp', { timeZone: zone.replaceAll('_', ' ') })}
      </p>
      <div className="grid gap-5 min-[480px]:grid-cols-2">
        <TextInputField
          type="date"
          max="9999-12-31"
          label={t('create.date')}
          error={fieldText(errors[date])}
          {...form.register(date)}
        />
        <TextInputField
          type="time"
          label={t('create.time')}
          error={fieldText(errors[time])}
          {...form.register(time)}
        />
      </div>
    </fieldset>
  );
}

/** What the code gives, where, how often, and from what order. */
function OfferFields({
  form,
  events,
  kind,
}: {
  form: PromoForm;
  events: readonly EventSummary[];
  kind: PromoFormValues['kind'];
}) {
  const { t } = useTranslation('promo-codes');
  const fieldText = useFieldText();
  const { errors } = form.formState;
  return (
    <>
      <TextInputField
        label={t(kind === 'PERCENT' ? 'create.percent' : 'create.amount')}
        inputMode="numeric"
        autoComplete="off"
        error={fieldText(errors.value)}
        {...form.register('value')}
      />
      <SelectField label={t('create.event')} {...form.register('eventId')}>
        <NativeSelectOption value="">{t('create.everyEvent')}</NativeSelectOption>
        {events.map((event) => (
          <NativeSelectOption key={event.id} value={event.id}>
            {event.title}
          </NativeSelectOption>
        ))}
      </SelectField>
      <TextInputField
        label={t('create.limit')}
        help={t('create.limitHelp')}
        inputMode="numeric"
        autoComplete="off"
        error={fieldText(errors.maxRedemptions)}
        {...form.register('maxRedemptions')}
      />
      <TextInputField
        label={t('create.minOrder')}
        help={t('create.minOrderHelp')}
        inputMode="numeric"
        autoComplete="off"
        error={fieldText(errors.minOrder)}
        {...form.register('minOrder')}
      />
    </>
  );
}

function useCreate(zones: ReadonlyMap<string, string>, page: PageActions) {
  const { t } = useTranslation('promo-codes');
  const [refusal, setRefusal] = useState<PromoRefusal | null>(null);
  const schema = useMemo(
    () => promoFormSchema((eventId) => zoneFor(eventId || null, zones)),
    [zones],
  );
  const form = useForm<PromoFormValues>({
    resolver: zodResolver(schema),
    defaultValues: NEW_PROMO_VALUES,
  });
  const onSubmit = async (values: PromoFormValues) => {
    setRefusal(null);
    try {
      const body = newPromoPayload(values, zoneFor(values.eventId || null, zones));
      await createPromoCode(browserSession().api, body);
      form.reset(NEW_PROMO_VALUES);
      await page.done(t('status.created', { code: values.code.toUpperCase() }));
    } catch (error) {
      const found = promoRefusalOf(error);
      const field = REFUSAL_FIELD[found.kind];
      if (field) form.setError(field as keyof PromoFormValues, { message: found.kind });
      setRefusal(field ? null : found);
      if (found.isStale) page.reload();
    }
  };
  return { form, refusal, onSubmit };
}

/**
 * Making a code (design PD-116, PD-117). Amounts are in AMD, the pilot's currency, since a code
 * stores none (FR-100); its times are in its event's zone, or Yerevan's for every event.
 */
export function CreateForm({
  events,
  zones,
  page,
}: {
  /** The organization's own current events, to limit the code to. */
  events: readonly EventSummary[];
  zones: ReadonlyMap<string, string>;
  page: PageActions;
}) {
  const { t } = useTranslation('promo-codes');
  const headingId = useId();
  const fieldText = useFieldText();
  const { form, refusal, onSubmit } = useCreate(zones, page);
  const { errors, isSubmitting } = form.formState;
  const [kind, eventId] = useWatch({ control: form.control, name: ['kind', 'eventId'] });
  const zone = zoneFor(eventId || null, zones);
  return (
    <section aria-labelledby={headingId} className="flex max-w-[34rem] flex-col gap-3">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('create.title')}
      </h2>
      {refusal ? <PromoProblem refusal={refusal} /> : null}
      <AppForm onSubmit={form.handleSubmit(onSubmit)}>
        <TextInputField
          label={t('create.code')}
          help={t('create.codeHelp')}
          autoComplete="off"
          error={fieldText(errors.code)}
          {...form.register('code')}
        />
        <KindChoices form={form} />
        <OfferFields form={form} events={events} kind={kind} />
        <MomentFields form={form} which="from" zone={zone} />
        <MomentFields form={form} which="until" zone={zone} />
        <SubmitButton
          isSubmitting={isSubmitting}
          className={`w-auto self-start ${WRAPPING_BUTTON}`}
        >
          {isSubmitting ? t('create.creating') : t('create.submit')}
        </SubmitButton>
      </AppForm>
    </section>
  );
}

export { useFieldText };
