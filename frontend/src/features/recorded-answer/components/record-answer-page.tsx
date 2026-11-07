import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useRevalidator } from 'react-router';

import { browserSession } from '@/api/session';
import { guestListPath } from '@/features/events';
import { LoadedProblem } from '@/features/sending';
import {
  AppForm,
  SubmitButton,
  useLeaveGuard,
  WordedRefusal,
  WRAPPING_BUTTON,
} from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { Checkbox } from '@/ui/kit/checkbox';
import { Label } from '@/ui/kit/label';

import { recordAnswer } from '../api';
import { answerFormValues, type AnswerFormValues } from '../form-model';
import type { RecordAnswerData } from '../load';
import { answerPayload } from '../payload';
import { refusalOf, type AnswerRefusal } from '../refusals';
import { answerFormSchema } from '../schemas';
import type { AnsweringGuest } from '../types';
import { AttendanceFields, type AnswerForm } from './attendance-fields';
import { QuestionFields } from './question-fields';

/** A refusal in our words (FR-6: a 403 is worded, not hidden). */
export function AnswerProblem({ refusal }: { refusal: AnswerRefusal }) {
  const { t } = useTranslation('recorded-answer');
  return (
    <WordedRefusal
      message={t(`refused.${refusal.kind}`)}
      english={refusal.kind === 'other' ? refusal.sentence : undefined}
      requestId={'requestId' in refusal ? refusal.requestId : undefined}
    />
  );
}

function NotifyField({ form }: { form: AnswerForm }) {
  const { t } = useTranslation('recorded-answer');
  const id = useId();
  return (
    <Controller
      control={form.control}
      name="notifyGuest"
      render={({ field }) => (
        <div className="flex min-h-11 items-start gap-3">
          <Checkbox
            id={id}
            className="mt-1"
            checked={field.value}
            onCheckedChange={(checked) => field.onChange(checked === true)}
            aria-describedby={`${id}-help`}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor={id} className="leading-snug font-normal">
              {t('notify.label')}
            </Label>
            <span id={`${id}-help`} className="text-muted-foreground text-sm">
              {t('notify.help')}
            </span>
          </div>
        </div>
      )}
    />
  );
}

interface AnswerFormViewProps {
  data: RecordAnswerData;
  guest: AnsweringGuest;
  onRefused: (refusal: AnswerRefusal) => void;
}

/** Sends what changed, then goes back to the guest list, which says it was recorded. */
function useRecord(
  { data, guest, onRefused }: AnswerFormViewProps,
  form: AnswerForm,
  initial: AnswerFormValues,
) {
  const { t } = useTranslation('recorded-answer');
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  return async (values: AnswerFormValues) => {
    const body = answerPayload(guest, data.asking, initial, values);
    try {
      await recordAnswer(browserSession().api, data.event.id, guest.id, body);
      await navigate(guestListPath(data.event.id), {
        state: { status: t('status.recorded', { name: guest.name }) },
      });
    } catch (error) {
      const found = refusalOf(error);
      if (found.kind === 'questionRefused' && found.questionId) {
        form.setError(`answers.${found.questionId}`, { message: 'refused' });
      }
      onRefused(found);
      if (found.isStale) void revalidate();
    }
  };
}

function AnswerFormView(props: AnswerFormViewProps) {
  const { t } = useTranslation('recorded-answer');
  const { data, guest } = props;
  const [initial] = useState(() => answerFormValues(guest, data.asking));
  const form = useForm<AnswerFormValues>({
    resolver: zodResolver(answerFormSchema(guest.mode, data.asking)),
    defaultValues: initial,
  });
  useLeaveGuard(form);
  const record = useRecord(props, form, initial);
  return (
    <AppForm onSubmit={form.handleSubmit(record)} className="max-w-[34rem] gap-5">
      <AttendanceFields form={form} guest={guest} />
      {data.isAskingKnown ? null : <p className="m-0">{t('askingUnknown')}</p>}
      <QuestionFields asking={data.asking} form={form} />
      <NotifyField form={form} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton
          isSubmitting={form.formState.isSubmitting}
          className={`w-auto ${WRAPPING_BUTTON}`}
        >
          {form.formState.isSubmitting ? t('saving') : t('save')}
        </SubmitButton>
        <Button asChild variant="ghost" className={WRAPPING_BUTTON}>
          <Link to={guestListPath(data.event.id)}>{t('cancel')}</Link>
        </Button>
      </div>
    </AppForm>
  );
}

/** The form, or why there is none: the role can't read guests, or this one was erased. */
function PageBody({
  data,
  onRefused,
}: {
  data: RecordAnswerData;
  onRefused: (refusal: AnswerRefusal) => void;
}) {
  const { t } = useTranslation('recorded-answer');
  const { guest } = data;
  if (guest.kind !== 'ready') {
    return <LoadedProblem loaded={guest} refusedText={t('guestRefused')} />;
  }
  if (guest.value.isErased) return <p className="m-0">{t('erased')}</p>;
  return (
    <AnswerFormView
      key={`${guest.value.mode}-${guest.value.revision}`}
      data={data}
      guest={guest.value}
      onRefused={onRefused}
    />
  );
}

/**
 * Recording an answer a guest gave by phone or in person (docs/API.md §6; design PD-108). The
 * questions the guest's page requires are left for later, the guest isn't told unless the host
 * asks, and agreeing to a statement is left to the guest's own link. A form read at an earlier
 * revision of how guests answer is refused, and the page reloads with a fresh one (keyed on it).
 */
export function RecordAnswerPage({ data }: { data: RecordAnswerData }) {
  const { t } = useTranslation('recorded-answer');
  const [refusal, setRefusal] = useState<AnswerRefusal | null>(null);
  const { event, guest } = data;
  return (
    <section className="flex flex-col gap-5">
      <Link
        to={guestListPath(event.id)}
        className="text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline"
      >
        {t('back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('title')}</h1>
        <p className="text-muted-foreground m-0">
          {guest.kind === 'ready' ? guest.value.name : event.title}
        </p>
      </div>
      <p className="m-0 max-w-[40rem]">{t('lead')}</p>
      {refusal ? <AnswerProblem refusal={refusal} /> : null}
      <PageBody data={data} onRefused={setRefusal} />
    </section>
  );
}
