import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { problemFrom, type Problem } from '@/api/problems';
import { browserSession } from '@/api/session';
import type { EventDetail } from '@/features/events';
import { ProblemAlert, WRAPPING_BUTTON, type PageActions } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { Checkbox } from '@/ui/kit/checkbox';
import { Label } from '@/ui/kit/label';

import { setRemindersEnabled } from '../api';
import { Panel } from './shared';

function useSaveSetting(eventId: string, page: PageActions) {
  const { t } = useTranslation('follow-ups');
  const [isSaving, setIsSaving] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const save = async (isOn: boolean) => {
    setProblem(null);
    setIsSaving(true);
    try {
      await setRemindersEnabled(browserSession().api, eventId, isOn);
      await page.done(t(isOn ? 'automatic.savedOn' : 'automatic.savedOff'));
    } catch (error) {
      setProblem(problemFrom(error));
    } finally {
      setIsSaving(false);
    }
  };
  return { isSaving, problem, save };
}

/**
 * Switching the automatic reminders off for this event, or on again (design PD-111). A checkbox
 * and Save, not a switch, which the kit doesn't have; on until the host says otherwise, as the
 * backend has it. Offered with `event:write` (FR-6, PD-193); a 403 is still worded.
 */
export function AutomaticReminders({ event, page }: { event: EventDetail; page: PageActions }) {
  const { t } = useTranslation('follow-ups');
  const id = useId();
  const isOnNow = event.remindersEnabled ?? true;
  const [isOn, setIsOn] = useState(isOnNow);
  const { isSaving, problem, save } = useSaveSetting(event.id, page);
  return (
    <Panel title={t('automatic.title')}>
      <div className="flex min-h-11 items-start gap-3">
        <Checkbox
          id={id}
          className="mt-1"
          checked={isOn}
          onCheckedChange={(checked) => setIsOn(checked === true)}
          aria-describedby={`${id}-help`}
        />
        <div className="flex min-w-0 flex-col gap-1">
          <Label htmlFor={id} className="leading-snug font-normal">
            {t('automatic.label')}
          </Label>
          <span id={`${id}-help`} className="text-muted-foreground text-sm">
            {t('automatic.help')}
          </span>
        </div>
      </div>
      <p className="m-0 text-sm">{t(isOnNow ? 'automatic.nowOn' : 'automatic.nowOff')}</p>
      {problem ? (
        <ProblemAlert
          problem={problem}
          refused={(status) => t(status === 403 ? 'automatic.forbidden' : 'automatic.refused')}
        />
      ) : null}
      <Button
        className={`self-start ${WRAPPING_BUTTON}`}
        disabled={isOn === isOnNow || isSaving}
        onClick={() => void save(isOn)}
      >
        {isSaving ? t('automatic.saving') : t('automatic.save')}
      </Button>
    </Panel>
  );
}
