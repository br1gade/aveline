import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useRevalidator } from 'react-router';

import type { Problem } from '@/api/problems';
import { browserSession } from '@/api/session';
import { ProblemAlert } from '@/ui/app-form';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/ui/kit/alert-dialog';
import { Button } from '@/ui/kit/button';

import { changeAttendancePolicy, previewAttendancePolicy } from '../api';
import {
  attendanceRefusal,
  otherMode,
  type AttendanceChanged,
  type AttendancePreview,
} from '../attendance';
import { eventPath, venuesPath } from '../paths';
import type { AttendanceMode as Mode, EventDetail } from '../types';
import { NotifyGuests } from './notify-guests';

/** Why the page is back at the start: a stale preview, no venue to answer, or a mode in use. */
type Notice = 'stale' | 'noVenue' | 'sameMode';

type Step =
  | { kind: 'start'; notice: Notice | null }
  | { kind: 'previewed'; preview: AttendancePreview; transitionId: string }
  | { kind: 'changed'; changed: AttendanceChanged };

const START: Step = { kind: 'start', notice: null };

/**
 * Preview, then change. The retry id is made with each preview and sent again if the confirmation
 * is pressed again after a lost answer (docs/API.md §6). A refusal that means the preview is out
 * of date takes the page back to the start, saying why.
 */
function useAttendanceChange(event: EventDetail) {
  const { revalidate } = useRevalidator();
  const [step, setStep] = useState<Step>(START);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const mode: Mode = event.attendanceMode ?? 'EVENT_WIDE';

  const run = async (action: () => Promise<Step>) => {
    setProblem(null);
    setIsBusy(true);
    try {
      setStep(await action());
    } catch (error) {
      const refusal = attendanceRefusal(error);
      if (refusal.kind === 'problem') setProblem(refusal.problem);
      else setStep({ kind: 'start', notice: refusal.kind });
      if (refusal.kind === 'sameMode') void revalidate();
    } finally {
      setIsBusy(false);
    }
  };
  const preview = () =>
    run(async () => ({
      kind: 'previewed',
      preview: await previewAttendancePolicy(browserSession().api, event.id, otherMode(mode)),
      transitionId: crypto.randomUUID(),
    }));
  const change = (previewed: Extract<Step, { kind: 'previewed' }>) =>
    run(async () => {
      const { api } = browserSession();
      const changed = await changeAttendancePolicy(
        api,
        event.id,
        previewed.preview,
        previewed.transitionId,
      );
      void revalidate();
      return { kind: 'changed', changed };
    });
  return { mode, step, problem, isBusy, preview, change, cancel: () => setStep(START) };
}

function StartNotice({ notice, eventId }: { notice: Notice | null; eventId: string }) {
  const { t } = useTranslation('events');
  if (!notice) return null;
  return (
    <p role="status" className="m-0">
      {t(`attendance.notice.${notice}`)}{' '}
      {notice === 'noVenue' ? (
        <Link
          to={venuesPath(eventId)}
          className="text-primary underline underline-offset-4 hover:no-underline"
        >
          {t('attendance.toVenues')}
        </Link>
      ) : null}
    </p>
  );
}

interface PreviewProps {
  to: Mode;
  previewed: Extract<Step, { kind: 'previewed' }>;
  isBusy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * What the change sets back, then the question, which says there is no keeping the answers: a
 * change back later asks everyone again too (design PD-53).
 */
function PreviewPanel({ to, previewed, isBusy, onConfirm, onCancel }: PreviewProps) {
  const { t } = useTranslation('events');
  const [isAsking, setIsAsking] = useState(false);
  const { responses, seatedGuests } = previewed.preview.affected;
  return (
    <section className="bg-card border-border flex flex-col gap-3 border px-5 py-4">
      <h2 className="m-0 text-base font-medium">{t('attendance.preview.title')}</h2>
      <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
        <li>{t('attendance.preview.answers', { count: responses })}</li>
        {seatedGuests > 0 ? (
          <li>{t('attendance.preview.seats', { count: seatedGuests })}</li>
        ) : null}
      </ul>
      <div className="flex flex-wrap gap-3">
        <Button disabled={isBusy} onClick={() => setIsAsking(true)}>
          {t(`attendance.change.${to}`)}
        </Button>
        <Button variant="ghost" disabled={isBusy} onClick={onCancel}>
          {t('attendance.cancel')}
        </Button>
      </div>
      <AlertDialog open={isAsking} onOpenChange={setIsAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t(`attendance.confirmTitle.${to}`)}</AlertDialogTitle>
            <AlertDialogDescription>{t('attendance.confirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('attendance.cancel')}</AlertDialogCancel>
            <Button
              onClick={() => {
                setIsAsking(false);
                onConfirm();
              }}
            >
              {t('attendance.confirm')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

/** Once changed: the offer to tell guests, as after an edit, or, with no invitation, the result. */
function Changed({ event, changed }: { event: EventDetail; changed: AttendanceChanged }) {
  const { t } = useTranslation('events');
  const back = { to: eventPath(event.id), label: t('notify.back') };
  if (changed.notificationPath && event.invitation) {
    const offer = { slug: event.invitation.slug, households: 0 };
    return <NotifyGuests offer={offer} back={back} lead={t('attendance.notifyLead')} />;
  }
  return (
    <section className="flex flex-col gap-4">
      <p role="status" className="m-0">
        {t(`attendance.done.${changed.mode}`)}
      </p>
      <Link to={back.to} className="text-primary self-start underline underline-offset-4">
        {back.label}
      </Link>
    </section>
  );
}

/**
 * How guests answer (docs/API.md §6; design PD-53): once for the whole event, or for each venue
 * guests see. Changing it sets every answer back and asks guests again, so it is previewed and
 * confirmed first. Offered to every role; one without `event:write` is told so (FR-6).
 */
export function AttendanceSettings({ event }: { event: EventDetail }) {
  const { t } = useTranslation('events');
  const { mode, step, problem, isBusy, preview, change, cancel } = useAttendanceChange(event);
  if (step.kind === 'changed') return <Changed event={event} changed={step.changed} />;
  const to = otherMode(mode);
  return (
    <section className="flex max-w-[40rem] flex-col gap-5">
      <Link
        to={eventPath(event.id)}
        className="text-primary self-start underline underline-offset-4"
      >
        {t('attendance.back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">
          {t('attendance.title')}
        </h1>
        <p className="text-muted-foreground m-0">{event.title}</p>
      </div>
      <p className="m-0 font-medium">{t(`attendance.now.${mode}`)}</p>
      <p className="m-0">{t(`attendance.explain.${to}`)}</p>
      {problem ? (
        <ProblemAlert
          problem={problem}
          refused={(status) => t(`attendance.problems.${status === 403 ? 'forbidden' : 'other'}`)}
        />
      ) : null}
      {step.kind === 'start' ? (
        <>
          <StartNotice notice={step.notice} eventId={event.id} />
          <Button className="self-start" disabled={isBusy} onClick={() => void preview()}>
            {t('attendance.see')}
          </Button>
        </>
      ) : (
        <PreviewPanel
          to={to}
          previewed={step}
          isBusy={isBusy}
          onConfirm={() => void change(step)}
          onCancel={cancel}
        />
      )}
    </section>
  );
}
