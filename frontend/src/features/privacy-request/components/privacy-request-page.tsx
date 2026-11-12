import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useMemo, useState } from 'react';
import { Controller, useForm, type Control, type FieldError } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { createPublicApi } from '@/api/client';
import { isApiError } from '@/api/errors';
import { problemFrom, type Problem } from '@/api/problems';
import { readPublicEnv } from '@/config/env';
import { PublicFrame } from '@/features/public-event';
import { DEFAULT_TIME_ZONE, formatEventDay } from '@/lib/time';
import { APP_PATHS } from '@/route-paths';
import {
  AppForm,
  ErrorLine,
  ProblemAlert,
  SubmitButton,
  TextInputField,
  useLeaveGuard,
} from '@/ui/app-form';
import { FieldDescription, FieldLabel, FieldLegend, FieldSet } from '@/ui/kit/field';
import { Label } from '@/ui/kit/label';
import { RadioGroup, RadioGroupItem } from '@/ui/kit/radio-group';
import { Textarea } from '@/ui/kit/textarea';

import { submitPrivacyRequest } from '../api';
import { privacyRequestSchema, REQUEST_KINDS, type PrivacyRequestValues } from '../schemas';

const EMPTY: PrivacyRequestValues = { kind: 'EXPORT', subjectEmail: '', notes: '' };

function KindChoice({ control }: { control: Control<PrivacyRequestValues> }) {
  const { t } = useTranslation('privacy-request');
  const id = useId();
  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label">{t('kind.legend')}</FieldLegend>
      <Controller
        control={control}
        name="kind"
        render={({ field }) => (
          <RadioGroup value={field.value} onValueChange={field.onChange} className="gap-1">
            {REQUEST_KINDS.map((kind) => (
              <div key={kind} className="flex min-h-11 items-center gap-3">
                <RadioGroupItem value={kind} id={`${id}-${kind}`} />
                <Label htmlFor={`${id}-${kind}`} className="font-normal">
                  {t(`kind.${kind}`)}
                </Label>
              </div>
            ))}
          </RadioGroup>
        )}
      />
    </FieldSet>
  );
}

function usePrivacyRequest() {
  const { i18n } = useTranslation();
  const api = useMemo(
    () => createPublicApi(readPublicEnv().VITE_API_BASE_URL, { getLanguage: () => i18n.language }),
    [i18n],
  );
  const form = useForm({ resolver: zodResolver(privacyRequestSchema), defaultValues: EMPTY });
  useLeaveGuard(form);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [dueAt, setDueAt] = useState<string | null>(null);
  const send = async (values: PrivacyRequestValues) => {
    setProblem(null);
    setDueAt(null);
    try {
      const recorded = await submitPrivacyRequest(api, values);
      form.reset(EMPTY);
      setDueAt(recorded.dueAt);
    } catch (error) {
      if (isApiError(error) && error.messages.some((said) => said.startsWith('subjectEmail'))) {
        form.setError('subjectEmail', { type: 'server' });
      } else {
        setProblem(problemFrom(error));
      }
    }
  };
  return { form, problem, dueAt, send };
}

function NotesField({
  error,
  ...field
}: ReturnType<ReturnType<typeof useForm<PrivacyRequestValues>>['register']> & {
  error: FieldError | undefined;
}) {
  const { t } = useTranslation('privacy-request');
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel htmlFor={id}>{t('notes')}</FieldLabel>
      <Textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-help ${id}-error` : `${id}-help`}
        {...field}
      />
      <FieldDescription id={`${id}-help`}>{t('notesHelp')}</FieldDescription>
      {error ? <ErrorLine id={`${id}-error`}>{t('errors.notes')}</ErrorLine> : null}
    </div>
  );
}

/**
 * The form for a data-subject request (docs/API.md §6; design PD-156). What it says afterwards
 * mustn't change with what is held, which is why the backend's own sentence isn't shown. **The words
 * are provisional and unreviewed** (PQ-25). The address and notes stay out of the address bar,
 * storage and logs, and leave the page when they are sent.
 */
export function PrivacyRequestPage() {
  const { t, i18n } = useTranslation('privacy-request');
  const { form, problem, dueAt, send } = usePrivacyRequest();
  const { errors, isSubmitting } = form.formState;
  const zone = { timeZone: DEFAULT_TIME_ZONE, locale: i18n.language };
  return (
    <PublicFrame>
      <div className="flex flex-col gap-3">
        <h1 className="text-heading m-0 font-serif text-[36px] leading-[42px] font-light">
          {t('title')}
        </h1>
        <p className="m-0">{t('lead')}</p>
        <Link
          to={APP_PATHS.privacy}
          className="text-action inline-flex min-h-11 items-center self-start underline decoration-1 underline-offset-3"
        >
          {t('noticeLink')}
        </Link>
      </div>
      {dueAt ? (
        <div role="status" className="flex flex-col gap-2">
          <p className="m-0 font-medium">{t('sent', { date: formatEventDay(dueAt, zone) })}</p>
          <p className="m-0">{t('sameAnswer')}</p>
        </div>
      ) : null}
      {problem ? <ProblemAlert problem={problem} refused={() => t('errors.refused')} /> : null}
      <AppForm onSubmit={(event) => void form.handleSubmit(send)(event)} className="gap-5">
        <KindChoice control={form.control} />
        <TextInputField
          label={t('email')}
          help={t('emailHelp')}
          type="email"
          autoComplete="email"
          error={errors.subjectEmail ? t('errors.email') : undefined}
          {...form.register('subjectEmail')}
        />
        <NotesField error={errors.notes} {...form.register('notes')} />
        <SubmitButton isSubmitting={isSubmitting} className="w-auto self-start">
          {isSubmitting ? t('submitting') : t('submit')}
        </SubmitButton>
      </AppForm>
    </PublicFrame>
  );
}
