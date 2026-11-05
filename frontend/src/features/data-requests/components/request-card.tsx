import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { browserSession } from '@/api/session';
import { useLeaveGuard, WRAPPING_BUTTON, type PageActions } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { Label } from '@/ui/kit/label';
import { Textarea } from '@/ui/kit/textarea';

import { updateRequest } from '../api';
import { requestRefusalOf, type RequestRefusal } from '../refusals';
import { isClosed, isStuckWithoutAddress, nextSteps, type RequestStep } from '../steps';
import type { DataRequest } from '../types';
import { RequestProblem, useRequestDay } from './shared';

/** `UpdateDataSubjectRequestDto`'s limit. A requester's own can run to ten times that (FR-126). */
const NOTES_LIMIT = 2000;
const notesSchema = z.object({ notes: z.string().trim().max(NOTES_LIMIT) });
type NotesValues = z.infer<typeof notesSchema>;

function useNotes(request: DataRequest, page: PageActions) {
  const { t } = useTranslation('data-requests');
  const [refusal, setRefusal] = useState<RequestRefusal | null>(null);
  const form = useForm<NotesValues>({
    resolver: zodResolver(notesSchema),
    defaultValues: { notes: request.notes ?? '' },
  });
  useLeaveGuard(form);
  const save = async (values: NotesValues) => {
    setRefusal(null);
    try {
      await updateRequest(browserSession().api, request.id, values);
      form.reset(values);
      await page.done(t('status.notes'));
    } catch (error) {
      const found = requestRefusalOf(error);
      setRefusal(found);
      if (found.isStale) page.reload();
    }
  };
  return { form, refusal, save };
}

interface NotesProps {
  form: UseFormReturn<NotesValues>;
  refusal: RequestRefusal | null;
  save: (values: NotesValues) => Promise<void>;
  who: string;
}

function NotesForm({ form, refusal, save, who }: NotesProps) {
  const { t } = useTranslation('data-requests');
  const id = useId();
  return (
    <form
      method="post"
      noValidate
      className="flex flex-col gap-2"
      onSubmit={(event) => void form.handleSubmit(save)(event)}
    >
      <Label htmlFor={id}>{t('notes.label')}</Label>
      <Textarea id={id} {...form.register('notes')} />
      {form.formState.errors.notes ? (
        <p role="alert" className="text-destructive m-0 text-sm">
          {t('notes.tooLong')}
        </p>
      ) : null}
      {refusal ? <RequestProblem refusal={refusal} /> : null}
      <Button
        type="submit"
        variant="outline"
        className={`${WRAPPING_BUTTON} self-start`}
        disabled={form.formState.isSubmitting}
        aria-label={t('stepFor', { step: t('notes.save'), who })}
      >
        {t('notes.save')}
      </Button>
    </form>
  );
}

const READ_ONLY_NOTES = 'm-0 text-sm break-words whitespace-pre-wrap';

interface RequestCardProps {
  request: DataRequest;
  now: number;
  page: PageActions;
  onStep: (request: DataRequest, step: RequestStep, opener: HTMLElement) => void;
}

function RequestFacts({ request, now }: Pick<RequestCardProps, 'request' | 'now'>) {
  const { t } = useTranslation('data-requests');
  const day = useRequestDay();
  const isOverdue = !isClosed(request.status) && Date.parse(request.dueAt) < now;
  return (
    <>
      <p className="m-0 text-sm">
        {t(`kind.${request.kind}`)} · {t(`state.${request.status}`)}
      </p>
      <p className="m-0 text-sm">
        {t('dates', { received: day(request.requestedAt), due: day(request.dueAt) })}
      </p>
      {isOverdue ? (
        <p className="text-destructive m-0 text-sm font-medium">{t('overdue')}</p>
      ) : null}
      {isStuckWithoutAddress(request) ? <p className="m-0 text-sm">{t('noAddressHelp')}</p> : null}
      {request.erasureAppliedAt && !isClosed(request.status) ? (
        <p className="m-0 text-sm">{t('erase.appliedWaiting')}</p>
      ) : null}
    </>
  );
}

function StepButtons({
  request,
  who,
  onStep,
}: Pick<RequestCardProps, 'request' | 'onStep'> & { who: string }) {
  const { t } = useTranslation('data-requests');
  const steps = nextSteps(request);
  if (steps.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {steps.map((step) => (
        <Button
          key={step}
          variant={step === 'reject' ? 'outline' : 'default'}
          className={WRAPPING_BUTTON}
          aria-label={t('stepFor', { step: t(`step.${step}`), who })}
          onClick={(click) => onStep(request, step, click.currentTarget)}
        >
          {t(`step.${step}`)}
        </Button>
      ))}
    </div>
  );
}

/**
 * One request: who, what, how long is left, its notes and what may be done next (`steps.ts`). A step
 * waits for notes still being typed, as one that closes the request would leave them behind unsaid.
 * Notes a requester has run past what may be sent are read, not edited, as saving would mean cutting
 * their words (FR-126).
 */
export function RequestCard({ request, now, page, onStep }: RequestCardProps) {
  const { t } = useTranslation('data-requests');
  const notes = useNotes(request, page);
  const [isHeldBack, setIsHeldBack] = useState(false);
  const who = request.subjectEmail ?? t('noAddress');
  const isDraft = notes.form.formState.isDirty;
  const isEditable = !isClosed(request.status) && (request.notes?.length ?? 0) <= NOTES_LIMIT;
  const step: RequestCardProps['onStep'] = (...args) => {
    setIsHeldBack(isDraft);
    if (!isDraft) onStep(...args);
  };
  return (
    <li className="bg-card border-border flex flex-col gap-2 border px-5 py-4">
      <span className="font-medium break-words">{who}</span>
      <RequestFacts request={request} now={now} />
      {isEditable ? (
        <NotesForm {...notes} who={who} />
      ) : (
        <>
          {request.notes ? <p className={READ_ONLY_NOTES}>{request.notes}</p> : null}
          {isClosed(request.status) ? null : (
            <p className="text-muted-foreground m-0 text-sm">{t('notes.tooLongToEdit')}</p>
          )}
        </>
      )}
      {isHeldBack && isDraft ? (
        <p role="alert" className="text-destructive m-0 text-sm">
          {t('notes.saveFirst')}
        </p>
      ) : null}
      <StepButtons request={request} who={who} onStep={step} />
    </li>
  );
}
