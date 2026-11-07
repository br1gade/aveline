import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { formatEventDay, formatEventTime } from '@/lib/time';
import { ProblemAlert, SubmitButton } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/ui/kit/dialog';

import type { SeatingRefusal } from '../refusals';
import type { SeatingHost } from './use-seating-host';

/** Keys whose own words say less than the backend's sentence, which is shown under them in English. */
const WITH_SENTENCE: readonly string[] = ['conflict.start', 'other'];

/** Our words for a seating refusal, by action and status; a server failure with its reference. */
export function SeatingProblem({ refusal }: { refusal: SeatingRefusal }) {
  const { t } = useTranslation('seating');
  const sentences = WITH_SENTENCE.includes(refusal.key) ? refusal.messages : [];
  return (
    <ProblemAlert
      problem={refusal.problem}
      refused={() => (
        <>
          {t(`problems.${refusal.key}`)}
          {sentences.map((message) => (
            <span key={message} lang="en" className="block">
              {message}
            </span>
          ))}
        </>
      )}
    />
  );
}

/** A moment in the event's own zone, never the device's: "Saturday, 12 June 2027, 14:30". */
export function useEventMoment(timeZone: string): (iso: string) => string {
  const { i18n } = useTranslation();
  const zone = { timeZone, locale: i18n.language };
  return (iso) => `${formatEventDay(iso, zone)}, ${formatEventTime(iso, zone)}`;
}

/**
 * Names joined by commas, the same in every language. `Intl.ListFormat` would add "and", but Chrome
 * ships no Armenian list data and would write English on an Armenian page (as with dates, §6).
 */
export function nameList(names: readonly string[]): string {
  return names.join(', ');
}

export const LINK =
  'text-primary inline-flex min-h-11 items-center self-start underline underline-offset-4 hover:no-underline';
export const PANEL = 'bg-card border-border flex flex-col gap-3 border px-5 py-4';
/** The kit's buttons never wrap; a long Armenian label would run past a 360 px screen. */
export const WRAP =
  'h-auto min-h-10 py-2 text-left whitespace-normal pointer-coarse:h-auto pointer-coarse:min-h-11';

/** A form dialog's Cancel and its press, disabled until the page is hydrated (design PD-41). */
export function FormFooter({ isSubmitting, label }: { isSubmitting: boolean; label: string }) {
  const { t } = useTranslation('seating');
  return (
    <DialogFooter>
      <DialogClose asChild>
        <Button type="button" variant="ghost">
          {t('dialog.cancel')}
        </Button>
      </DialogClose>
      <SubmitButton isSubmitting={isSubmitting} className="w-auto">
        {label}
      </SubmitButton>
    </DialogFooter>
  );
}

interface FormDialogProps {
  host: SeatingHost;
  title: string;
  refusal: SeatingRefusal | null;
  children: ReactNode;
}

/** A dialog at most 30 rem wide, its refusal above the form; the focus goes back as it closes. */
export function FormDialog({ host, title, refusal, children }: FormDialogProps) {
  return (
    <Dialog open onOpenChange={(isOpen) => (isOpen ? undefined : host.close())}>
      <DialogContent
        aria-describedby={undefined}
        className="sm:max-w-[30rem]"
        onCloseAutoFocus={host.restoreFocus}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        {refusal ? <SeatingProblem refusal={refusal} /> : null}
        {children}
      </DialogContent>
    </Dialog>
  );
}
