import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { problemFrom, type Problem } from '@/api/problems';
import { browserSession } from '@/api/session';
import {
  AppForm,
  ErrorLine,
  ProblemAlert,
  SubmitButton,
  TextInputField,
  useLeaveGuard,
} from '@/ui/app-form';
import { ChangeableWith } from '@/features/permissions';
import { Button } from '@/ui/kit/button';
import { FieldLegend, FieldSet } from '@/ui/kit/field';

import { createTicketType, updateTicketType } from '../api';
import {
  languagesWithStored,
  ticketTypeFormValues,
  type TicketTypeFormValues,
  type TypeContext,
} from '../form-model';
import type { TicketTypeData } from '../load';
import { ticketSalesPath } from '../paths';
import { createTicketTypeBody, updateTicketTypeBody } from '../payload';
import { inLanguage } from '../read';
import { typeRefusal } from '../refusals';
import { ticketTypeSchema } from '../schemas';
import type { TicketType } from '../types';
import { LINK } from './shared';
import { eventLanguages, useFormText, useLanguageLabel } from './use-form-text';

type Form = UseFormReturn<TicketTypeFormValues>;

function Translated({
  form,
  field,
  languages,
  labelOf,
}: {
  form: Form;
  field: 'names' | 'descriptions';
  languages: readonly string[];
  labelOf: (language: string) => string;
}) {
  const { t } = useTranslation('ticket-sales');
  const text = useFormText();
  // A record's own error sits on the record itself, not on any language under it.
  const ownError = form.formState.errors.names as { message?: string } | undefined;
  const error = field === 'names' ? text(ownError?.message) : undefined;
  return (
    <FieldSet className="gap-3">
      <FieldLegend>{t(`typeForm.${field}`)}</FieldLegend>
      {languages.map((language) => (
        <TextInputField
          key={language}
          label={labelOf(language)}
          lang={language}
          {...form.register(`${field}.${language}`)}
        />
      ))}
      {error ? <ErrorLine id={`type-${field}-error`}>{error}</ErrorLine> : null}
    </FieldSet>
  );
}

function SalesEdge({
  form,
  edge,
  timeZone,
}: {
  form: Form;
  edge: 'salesStart' | 'salesEnd';
  timeZone: string;
}) {
  const { t } = useTranslation('ticket-sales');
  const text = useFormText();
  const { errors } = form.formState;
  return (
    <FieldSet className="gap-3">
      <FieldLegend>{t(`typeForm.${edge}`)}</FieldLegend>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInputField
          type="date"
          label={t('typeForm.date')}
          error={text(errors[`${edge}Date`]?.message)}
          {...form.register(`${edge}Date`)}
        />
        <TextInputField
          type="time"
          label={t('typeForm.time')}
          error={text(errors[`${edge}Time`]?.message)}
          {...form.register(`${edge}Time`)}
        />
      </div>
      <p className="text-muted-foreground m-0 text-sm">
        {t('typeForm.zone', { timeZone: timeZone.replaceAll('_', ' ') })}
      </p>
    </FieldSet>
  );
}

function Limits({
  form,
  type,
  currency,
}: {
  form: Form;
  type: TicketType | null;
  currency: string;
}) {
  const { t } = useTranslation('ticket-sales');
  const text = useFormText();
  const { errors } = form.formState;
  const sold = type?.sold ?? 0;
  const held = type?.held ?? 0;
  const taken = sold + held;
  return (
    <>
      <TextInputField
        inputMode="decimal"
        label={t('typeForm.price', { currency })}
        help={t('typeForm.priceHelp')}
        error={text(errors.price?.message)}
        {...form.register('price')}
      />
      <TextInputField
        inputMode="numeric"
        label={t('typeForm.quantity')}
        help={taken > 0 ? t('typeForm.taken', { sold, held, taken }) : undefined}
        error={text(errors.quantityTotal?.message)}
        {...form.register('quantityTotal')}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextInputField
          inputMode="numeric"
          label={t('typeForm.min')}
          error={text(errors.minPerOrder?.message)}
          {...form.register('minPerOrder')}
        />
        <TextInputField
          inputMode="numeric"
          label={t('typeForm.max')}
          error={text(errors.maxPerOrder?.message)}
          {...form.register('maxPerOrder')}
        />
      </div>
    </>
  );
}

interface Saving {
  eventId: string;
  type: TicketType | null;
  baseline: TicketTypeFormValues;
  context: TypeContext;
}

/** Sends the form: a new type whole; a correction only what changed, and nothing when nothing did. */
async function save(values: TicketTypeFormValues, { eventId, type, baseline, context }: Saving) {
  const { api } = browserSession();
  if (!type) return createTicketType(api, eventId, createTicketTypeBody(values, context));
  const body = updateTicketTypeBody(baseline, values, context);
  return Object.keys(body).length > 0 ? updateTicketType(api, eventId, type.id, body) : undefined;
}

function refusedWords(status: number): 'forbidden' | 'types.refusals.capacityTaken' | 'refused' {
  if (status === 403) return 'forbidden';
  return status === 409 ? 'types.refusals.capacityTaken' : 'refused';
}

function useTypeForm({ event, type }: TicketTypeData) {
  const navigate = useNavigate();
  const context = useMemo(
    () => ({
      languages: languagesWithStored(
        eventLanguages(event),
        type?.name ?? {},
        type?.description ?? {},
      ),
      timeZone: event.timezone,
      currency: type?.currency ?? 'AMD',
    }),
    [event, type],
  );
  const [baseline] = useState(() => ticketTypeFormValues(type, context));
  const schema = useMemo(
    () =>
      ticketTypeSchema({
        ...context,
        taken: type ? type.sold + type.held : 0,
        startWasSet: Boolean(type?.salesStartAt),
        endWasSet: Boolean(type?.salesEndAt),
      }),
    [context, type],
  );
  const form = useForm<TicketTypeFormValues>({
    resolver: zodResolver(schema),
    defaultValues: baseline,
  });
  useLeaveGuard(form);
  const [problem, setProblem] = useState<Problem | null>(null);
  const onSubmit = async (values: TicketTypeFormValues) => {
    setProblem(null);
    try {
      await save(values, { eventId: event.id, type, baseline, context });
      await navigate(ticketSalesPath(event.id));
    } catch (error) {
      const refusal = typeRefusal(error);
      if (refusal.kind !== 'fields') setProblem(problemFrom(error));
      else refusal.paths.forEach((path) => form.setError(path as 'price', { message: 'refused' }));
    }
  };
  return { context, form, problem, onSubmit };
}

/**
 * Adding or correcting a ticket type (design PD-85): its name and description in each of the
 * event's languages, its price, how many, per-order limits and the sales window in the event's
 * zone. A correction sends only what changed; a window once set can be moved, not removed (FR-67).
 */
export function TicketTypeForm({ data }: { data: TicketTypeData }) {
  const { t, i18n } = useTranslation('ticket-sales');
  const { event, type } = data;
  const { context, form, problem, onSubmit } = useTypeForm(data);
  const labelOf = useLanguageLabel(event);
  const name = type ? inLanguage(type.name, i18n.language, event.defaultLocale) : null;
  return (
    <section className="flex max-w-[34rem] flex-col gap-5">
      <Link to={ticketSalesPath(event.id)} className={LINK}>
        {t('typeForm.back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">
          {name ? t('typeForm.editTitle', { name }) : t('typeForm.newTitle')}
        </h1>
        <p className="text-muted-foreground m-0">{event.title}</p>
      </div>
      {type ? <p className="m-0">{t('typeForm.priceNote')}</p> : null}
      {problem ? (
        <ProblemAlert problem={problem} refused={(status) => t(refusedWords(status))} />
      ) : null}
      <ChangeableWith to="event:write" readOnly={t('forbidden')}>
        <AppForm onSubmit={form.handleSubmit(onSubmit)} className="gap-5">
          <Translated form={form} field="names" languages={context.languages} labelOf={labelOf} />
          <Translated
            form={form}
            field="descriptions"
            languages={context.languages}
            labelOf={labelOf}
          />
          <Limits form={form} type={type} currency={context.currency} />
          <SalesEdge form={form} edge="salesStart" timeZone={event.timezone} />
          <SalesEdge form={form} edge="salesEnd" timeZone={event.timezone} />
          <p className="text-muted-foreground m-0 text-sm">{t('typeForm.windowNote')}</p>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton isSubmitting={form.formState.isSubmitting} className="w-auto">
              {t(type ? 'typeForm.save' : 'typeForm.add')}
            </SubmitButton>
            <Button asChild variant="ghost">
              <Link to={ticketSalesPath(event.id)}>{t('cancel')}</Link>
            </Button>
          </div>
        </AppForm>
      </ChangeableWith>
    </section>
  );
}

/** A type removed meanwhile is said so, with the way back. */
export function TicketTypePage({ data }: { data: TicketTypeData }) {
  const { t } = useTranslation('ticket-sales');
  if (!data.isGone) return <TicketTypeForm data={data} />;
  return (
    <section className="flex max-w-[34rem] flex-col gap-4">
      <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">
        {t('typeForm.goneTitle')}
      </h1>
      <p className="m-0">{t('typeForm.goneBody')}</p>
      <Link to={ticketSalesPath(data.event.id)} className={LINK}>
        {t('typeForm.back')}
      </Link>
    </section>
  );
}
