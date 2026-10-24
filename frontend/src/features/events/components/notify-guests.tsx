import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { browserSession } from '@/api/session';
import {
  AccountForm,
  ProblemAlert,
  problemFrom,
  SubmitButton,
  type Problem,
} from '@/features/account';
import { Button } from '@/ui/kit/button';
import { Field, FieldDescription, FieldLabel } from '@/ui/kit/field';
import { Textarea } from '@/ui/kit/textarea';

import { notifyChanges } from '../api';
import { eventPath } from '../paths';
import { useRefusedText } from '../refusals';
import type { NotifyResult } from '../types';

/** What the edit's `notice` offered: the invitation to announce on, and who holds it. */
export interface NotifyOffer {
  slug: string;
  households: number;
}

/** The note's limit on the backend (`NotifyChangesDto`). */
const NOTE_LIMIT = 500;

function NotifySent({ result, eventId }: { result: NotifyResult; eventId: string }) {
  const { t } = useTranslation('events');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const unreachable = result.unreachable.length;
  const isNobody = result.queued === 0 && result.alreadyNotified === 0 && unreachable === 0;
  return (
    <div ref={ref} tabIndex={-1} className="flex flex-col gap-2 outline-none">
      {result.queued > 0 ? (
        <p className="m-0">{t('notify.sent', { count: result.queued })}</p>
      ) : null}
      {result.alreadyNotified > 0 ? (
        <p className="m-0">{t('notify.already', { count: result.alreadyNotified })}</p>
      ) : null}
      {unreachable > 0 ? (
        <p className="m-0">{t('notify.unreachable', { count: unreachable })}</p>
      ) : null}
      {isNobody ? <p className="m-0">{t('notify.nobody')}</p> : null}
      <Button asChild variant="outline" className="self-start">
        <Link to={eventPath(eventId)}>{t('notify.back')}</Link>
      </Button>
    </div>
  );
}

function NoteField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation('events');
  const id = useId();
  return (
    <Field className="gap-2">
      <FieldLabel htmlFor={id}>{t('notify.note')}</FieldLabel>
      <Textarea
        id={id}
        value={value}
        maxLength={NOTE_LIMIT}
        aria-describedby={`${id}-help`}
        onChange={(change) => onChange(change.target.value)}
      />
      <FieldDescription id={`${id}-help`}>{t('notify.noteHelp')}</FieldDescription>
    </Field>
  );
}

/**
 * "Let your guests know", offered after an edit whose notice suggests it, and sent only when the
 * host presses it (docs/API.md §6, decided 8 October 2026). Once sent, the button is gone.
 */
export function NotifyGuests({ eventId, offer }: { eventId: string; offer: NotifyOffer }) {
  const { t } = useTranslation('events');
  const refused = useRefusedText('notify');
  const heading = useRef<HTMLHeadingElement>(null);
  const [note, setNote] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [result, setResult] = useState<NotifyResult | null>(null);
  useEffect(() => heading.current?.focus(), []);

  const send = async () => {
    setProblem(null);
    setIsSending(true);
    try {
      setResult(await notifyChanges(browserSession().api, offer.slug, note.trim()));
    } catch (error) {
      setProblem(problemFrom(error));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <section className="flex max-w-[30rem] flex-col gap-5">
      <h1
        ref={heading}
        tabIndex={-1}
        className="m-0 font-serif text-[28px] leading-[34px] font-normal outline-none"
      >
        {t('notify.title')}
      </h1>
      <p className="m-0">{t('notify.body', { count: offer.households })}</p>
      {problem ? <ProblemAlert problem={problem} refused={refused} /> : null}
      {result ? (
        <NotifySent result={result} eventId={eventId} />
      ) : (
        <AccountForm
          onSubmit={(submit) => {
            submit.preventDefault();
            void send();
          }}
          className="gap-5"
        >
          <NoteField value={note} onChange={setNote} />
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton isSubmitting={isSending} className="w-auto">
              {isSending ? t('notify.sending') : t('notify.send')}
            </SubmitButton>
            <Button asChild variant="ghost">
              <Link to={eventPath(eventId)}>{t('notify.later')}</Link>
            </Button>
          </div>
        </AccountForm>
      )}
    </section>
  );
}
