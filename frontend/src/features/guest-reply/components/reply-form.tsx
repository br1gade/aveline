import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { FormProvider, useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { Invitation } from '@/features/invitation-renderer';
import { Button, Icon, Notice } from '@/ui';
import { ErrorSummary } from '@/ui/form';

import { fieldId, flattenErrors } from '../fields';
import {
  answerableQuestions,
  fullName,
  initialValues,
  neverAnswered,
  replySchema,
  type ReplyFormValues,
} from '../form-model';
import type { FieldProblem, SendProblem } from '../server-errors';
import type { ReplyRecord } from '../types';
import { useErrorText } from '../use-error-text';
import {
  DietarySection,
  DrinkSection,
  MessageSection,
  SideSection,
  SongSection,
} from './detail-sections';
import { ReplyFormProvider, useReplyForm } from './form-context';
import { AnswerSection, HouseholdSection, PartySection } from './household-sections';
import { QuestionSection } from './question-section';

/**
 * The respondent's own answers to the host's questions. When others on the form answer the same
 * questions, these go under the respondent's name too, so it is clear whose they are (PD-38).
 */
function OwnQuestions() {
  const { form, record, invitation } = useReplyForm();
  const party = useWatch({ control: form.control, name: 'party' });
  const hasOthers = record.household.members.length > 0 || party.length > 0;
  if (!hasOthers || answerableQuestions(invitation.rsvpQuestions).length === 0) {
    return <QuestionSection />;
  }
  return (
    <div className="border-hairline grid gap-6 border-l pl-4">
      <p className="text-ink m-0 text-base leading-6 font-medium">{fullName(record.guest)}</p>
      <QuestionSection />
    </div>
  );
}

/**
 * What only an attending guest is asked (spec §6.1b–g). A built-in question shows only when the
 * invitation asks it (`rsvpFields`); the side, only when both side labels exist too.
 */
function AttendingSections() {
  const { invitation, record, field } = useReplyForm();
  const { household } = record;
  const seatsLeft = household.seatsAllotted - 1 - household.members.length;
  const { a, b } = invitation.event.sides;
  return (
    <>
      {seatsLeft > 0 ? <PartySection seatsLeft={seatsLeft} /> : null}
      {field('attribution').isEnabled && a && b ? <SideSection sides={{ a, b }} /> : null}
      {field('dietary').isEnabled ? <DietarySection /> : null}
      {field('drinkPreference').isEnabled ? <DrinkSection /> : null}
      {field('songRequest').isEnabled ? <SongSection /> : null}
      <OwnQuestions />
    </>
  );
}

function Sections() {
  const { t } = useTranslation('reply');
  const { status, record, field } = useReplyForm();
  return (
    <>
      <AnswerSection />
      {status && record.household.members.length > 0 ? <HouseholdSection /> : null}
      {status === 'ATTENDING' ? <AttendingSections /> : null}
      {status === 'UNDECIDED' ? (
        <p className="text-ink-muted m-0">{t('answer.undecidedNote')}</p>
      ) : null}
      {status && field('message').isEnabled ? <MessageSection /> : null}
    </>
  );
}

/** One notice for a send that failed as a whole: closed, too many attempts, or no answer. */
function ProblemNotice({ problem }: { problem: SendProblem }) {
  const { t } = useTranslation('reply');
  const { t: tInvitation } = useTranslation('invitation');
  if (problem.kind === 'closed') return <Notice role="alert">{tInvitation('reply.closed')}</Notice>;
  if (problem.kind === 'rate-limited') {
    return (
      <Notice tone="error" role="alert">
        {t('errors.rateLimited')}
      </Notice>
    );
  }
  if (problem.kind !== 'failed') return null;
  const retry = (
    <Button type="submit" variant="secondary" className="self-start">
      {t('errors.retry')}
    </Button>
  );
  return (
    <Notice tone="error" role="alert" action={retry}>
      <p>{t('errors.failed')}</p>
      {problem.requestId ? (
        <p className="text-ink-muted mt-1 text-sm select-all">
          {t('errors.reference', { id: problem.requestId })}
        </p>
      ) : null}
    </Notice>
  );
}

/**
 * Where a refused field's link goes. A question the form does not show, such as a required
 * SIGNATURE (BQ-5, PD-23), has no field, so its link goes to the top of the form.
 */
function problemTarget(problem: FieldProblem, shown: ReadonlySet<string>): string {
  const question = /(?:^|\.)answers\.(.+)$/.exec(problem.field)?.[1];
  const isHiddenQuestion = question !== undefined && !shown.has(question);
  return fieldId(isHiddenQuestion ? 'status' : problem.field);
}

/**
 * The errors at the top: every field problem as a link, or one notice for the whole send. After
 * each attempt it takes focus once, on the first render that has something to say: the form's
 * errors arrive a render after the attempt itself, and later typing must not steal focus back.
 */
function Alerts({ problem, attempt }: { problem: SendProblem | null; attempt: number }) {
  const { t } = useTranslation('reply');
  const { form, serverProblems, errorText, invitation } = useReplyForm();
  const shown = new Set(answerableQuestions(invitation.rsvpQuestions).map((q) => q.id));
  const hasOther = problem?.kind === 'invalid' && problem.hasOther;
  const items = [
    ...flattenErrors(form.formState.errors).map((error) => ({
      target: fieldId(error.path),
      message: errorText(error.message),
    })),
    ...serverProblems.map((field) => ({
      target: problemTarget(field, shown),
      message: errorText(field.code),
    })),
    ...(hasOther ? [{ target: fieldId('status'), message: t('errors.other') }] : []),
  ];
  const alertRef = useRef<HTMLDivElement>(null);
  const focusedAttempt = useRef(0);
  const hasAlert = items.length > 0 || problem !== null;
  useEffect(() => {
    if (hasAlert && attempt > focusedAttempt.current) {
      focusedAttempt.current = attempt;
      alertRef.current?.focus();
    }
  });

  if (items.length > 0) {
    return <ErrorSummary ref={alertRef} title={t('errors.summaryTitle')} items={items} />;
  }
  if (!problem) return null;
  return (
    <div ref={alertRef} tabIndex={-1} className="focus:outline-none">
      <ProblemNotice problem={problem} />
    </div>
  );
}

function SendArea({ isSending }: { isSending: boolean }) {
  const { t } = useTranslation('reply');
  return (
    <div className="grid gap-3">
      <Button type="submit" isBlock aria-busy={isSending} aria-disabled={isSending || undefined}>
        {isSending ? (
          <Icon name="loader" className="animate-spin motion-reduce:animate-none" />
        ) : null}
        {isSending ? t('send.sending') : t('send.button')}
      </Button>
      <p className="text-ink-muted m-0 text-sm leading-[22px]">{t('send.reassurance')}</p>
    </div>
  );
}

interface ReplyFormProps {
  invitation: Invitation;
  record: ReplyRecord;
  /** Sends the reply; resolves to what went wrong, or `null` once it is saved. */
  onSend: (values: ReplyFormValues, initial: ReplyFormValues) => Promise<SendProblem | null>;
}

/**
 * The reply form (spec §6.1, §6.2). What the guest typed is never lost: a refusal, a failure and
 * closing mid-send all keep the entries, and focus moves to what went wrong.
 */
export function ReplyForm({ invitation, record, onSend }: ReplyFormProps) {
  const questions = invitation.rsvpQuestions;
  const initial = useMemo(() => initialValues(record, questions), [record, questions]);
  const resolver = useMemo(
    () => zodResolver(replySchema({ questions, neverAnswered: neverAnswered(record) })),
    [questions, record],
  );
  // Focus goes to the error summary, not the first field (spec §11), so the guest hears every
  // problem first.
  const form = useForm<ReplyFormValues>({
    resolver,
    defaultValues: initial,
    shouldFocusError: false,
  });
  const [problem, setProblem] = useState<SendProblem | null>(null);
  const [attempt, setAttempt] = useState(0);
  // A second press while sending is ignored (DESIGN_SYSTEM §10); state would read stale here.
  const isSendingRef = useRef(false);
  const errorText = useErrorText(record.household.seatsAllotted);
  const isSending = form.formState.isSubmitting;

  async function onValid(values: ReplyFormValues) {
    if (isSendingRef.current) return;
    isSendingRef.current = true;
    const result = await onSend(values, initial).finally(() => {
      isSendingRef.current = false;
    });
    setProblem(result);
    if (result) setAttempt((count) => count + 1);
  }
  function onInvalid() {
    setProblem(null);
    setAttempt((count) => count + 1);
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    void form.handleSubmit(onValid, onInvalid)(event);
  }
  const serverProblems = problem?.kind === 'invalid' ? problem.fields : [];

  return (
    <FormProvider {...form}>
      <ReplyFormProvider value={{ invitation, record, serverProblems, errorText }}>
        <form noValidate onSubmit={submit} className="grid gap-8">
          <Alerts problem={problem} attempt={attempt} />
          <fieldset
            disabled={problem?.kind === 'closed'}
            className="m-0 grid min-w-0 gap-8 border-0 p-0"
          >
            <Sections />
          </fieldset>
          {problem?.kind === 'closed' ? null : <SendArea isSending={isSending} />}
        </form>
      </ReplyFormProvider>
    </FormProvider>
  );
}
