import { useId } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { ErrorLine } from '@/ui/app-form';

import type { AnswerFormValues } from '../form-model';
import type { AnswerFieldCode } from '../schemas';
import type { AnsweringGuest } from '../types';
import { ReplyChoices } from './reply-choices';

export type AnswerForm = UseFormReturn<AnswerFormValues>;

const CODES: readonly string[] = [
  'chooseAnswer',
  'chooseVenue',
  'tooLong',
  'refused',
] satisfies Array<AnswerFieldCode | 'refused'>;

function isCode(code: unknown): code is AnswerFieldCode | 'refused' {
  return typeof code === 'string' && CODES.includes(code);
}

/** A field's error in words: a code from the schema, or `refused` from the server. */
function useErrorText(): (error: { message?: unknown } | undefined) => string | undefined {
  const { t } = useTranslation('recorded-answer');
  return (error) => (isCode(error?.message) ? t(`errors.${error.message}`) : undefined);
}

/** One answer for the whole event. */
function EventWide({ form }: { form: AnswerForm }) {
  const { t } = useTranslation('recorded-answer');
  const id = useId();
  const error = useErrorText()(form.formState.errors.status);
  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
      <legend id={`${id}-legend`} className="mb-1 p-0 text-sm font-medium">
        {t('attendance.eventWide')}
      </legend>
      <Controller
        control={form.control}
        name="status"
        render={({ field }) => (
          <ReplyChoices
            idPrefix={id}
            labelledBy={`${id}-legend`}
            value={field.value}
            onChange={field.onChange}
            describedBy={error ? `${id}-error` : undefined}
          />
        )}
      />
      {error ? <ErrorLine id={`${id}-error`}>{error}</ErrorLine> : null}
    </fieldset>
  );
}

/** One answer per venue guests see; a venue left unanswered keeps what it had. */
function PerVenue({ form, guest }: { form: AnswerForm; guest: AnsweringGuest }) {
  const { t } = useTranslation('recorded-answer');
  const id = useId();
  const error = useErrorText()(form.formState.errors.venues);
  return (
    <fieldset className="m-0 flex flex-col gap-4 border-0 p-0">
      <legend className="mb-1 p-0 text-sm font-medium">{t('attendance.perVenue')}</legend>
      <p className="text-muted-foreground m-0 text-sm">{t('attendance.perVenueHelp')}</p>
      {guest.venues.map((venue, index) => (
        <div key={venue.venueId} className="flex flex-col gap-1">
          <p id={`${id}-${index}`} className="m-0 font-medium">
            {venue.venue}
          </p>
          <Controller
            control={form.control}
            name={`venues.${venue.venueId}`}
            render={({ field }) => (
              <ReplyChoices
                idPrefix={`${id}-${index}`}
                labelledBy={`${id}-${index}`}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </div>
      ))}
      {error ? <ErrorLine id={`${id}-error`}>{error}</ErrorLine> : null}
    </fieldset>
  );
}

/** How the event takes answers decides the shape (docs/API.md §4, "Attendance modes"). */
export function AttendanceFields({ form, guest }: { form: AnswerForm; guest: AnsweringGuest }) {
  return guest.mode === 'PER_VENUE' ? (
    <PerVenue form={form} guest={guest} />
  ) : (
    <EventWide form={form} />
  );
}

export { useErrorText };
