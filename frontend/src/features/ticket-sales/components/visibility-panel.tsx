import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { problemFrom, type Problem } from '@/api/problems';
import { browserSession } from '@/api/session';
import type { EventVisibility } from '@/features/events';
import { ProblemAlert, type PageActions } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { Label } from '@/ui/kit/label';
import { RadioGroup, RadioGroupItem } from '@/ui/kit/radio-group';

import { setVisibility } from '../api';
import type { TicketSalesData } from '../load';
import { ConfirmDialog, HEADING, PANEL } from './shared';

const CHOICES: readonly EventVisibility[] = ['PRIVATE', 'UNLISTED', 'PUBLIC'];

export const VISIBILITY_HEADING_ID = 'who-can-find-it';

function isVisibility(value: string): value is EventVisibility {
  return (CHOICES as readonly string[]).includes(value);
}

interface ChoicesProps {
  choice: EventVisibility;
  current: EventVisibility;
  onChoose: (choice: EventVisibility) => void;
}

function Choices({ choice, current, onChoose }: ChoicesProps) {
  const { t } = useTranslation('ticket-sales');
  return (
    <RadioGroup
      value={choice}
      onValueChange={(value) => isVisibility(value) && onChoose(value)}
      className="gap-2"
    >
      {CHOICES.map((option) => (
        <div key={option} className="flex min-h-11 items-start gap-3">
          <RadioGroupItem
            value={option}
            id={`visibility-${option}`}
            aria-describedby={`visibility-${option}-about`}
            className="mt-1"
          />
          <div className="flex min-w-0 flex-col">
            <Label htmlFor={`visibility-${option}`} className="font-normal">
              {t(`visibility.${option}.name`)}
              {option === current ? ` · ${t('visibility.current')}` : ''}
            </Label>
            <span id={`visibility-${option}-about`} className="text-muted-foreground text-sm">
              {t(`visibility.${option}.about`)}
            </span>
          </div>
        </div>
      ))}
    </RadioGroup>
  );
}

function useSave(data: TicketSalesData, page: PageActions) {
  const { t } = useTranslation('ticket-sales');
  const [isSaving, setIsSaving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const save = async (choice: EventVisibility) => {
    setProblem(null);
    setIsSaving(true);
    try {
      await setVisibility(browserSession().api, data.event.id, choice);
      await page.done(t('visibility.saved', { choice: t(`visibility.${choice}.name`) }));
      return true;
    } catch (error) {
      setProblem(problemFrom(error));
      return false;
    } finally {
      setIsSaving(false);
    }
  };
  return { isSaving, problem, save };
}

/**
 * Who can find the event (design PD-84). Making it private takes a public announcement down in the
 * same act, so that asks first; the other changes save at once.
 */
export function VisibilityPanel({ data, page }: { data: TicketSalesData; page: PageActions }) {
  const { t } = useTranslation('ticket-sales');
  const current = data.event.visibility ?? 'PRIVATE';
  const [choice, setChoice] = useState<EventVisibility>(current);
  const [isAsking, setIsAsking] = useState(false);
  const { isSaving, problem, save } = useSave(data, page);
  const isTakingDown = choice === 'PRIVATE' && Boolean(data.listing?.publishedAt);
  const alert = problem ? (
    <ProblemAlert
      problem={problem}
      refused={(status) => t(status === 403 ? 'forbidden' : 'refused')}
    />
  ) : null;
  return (
    <section aria-labelledby={VISIBILITY_HEADING_ID} className={PANEL}>
      <h2 id={VISIBILITY_HEADING_ID} tabIndex={-1} className={HEADING}>
        {t('visibility.heading')}
      </h2>
      <Choices choice={choice} current={current} onChoose={setChoice} />
      {isAsking ? null : alert}
      <Button
        className="self-start"
        disabled={choice === current || isSaving}
        onClick={() => (isTakingDown ? setIsAsking(true) : void save(choice))}
      >
        {t('visibility.save')}
      </Button>
      {isAsking ? (
        <ConfirmDialog
          title={t('visibility.askTitle')}
          body={t('visibility.askBody')}
          confirmLabel={t('visibility.askConfirm')}
          isBusy={isSaving}
          problem={alert}
          onConfirm={() => void save(choice).then((isSaved) => isSaved && setIsAsking(false))}
          onClose={() => setIsAsking(false)}
          onCloseAutoFocus={page.focusStatus}
        />
      ) : null}
    </section>
  );
}
