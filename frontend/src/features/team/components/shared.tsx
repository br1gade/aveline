import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { WordedRefusal, WRAPPING_BUTTON } from '@/ui/app-form';
import { Label } from '@/ui/kit/label';
import { RadioGroup, RadioGroupItem } from '@/ui/kit/radio-group';

import { roleOf } from '../read';
import type { TeamRefusal } from '../refusals';
import { EVENT_ROLES, type EventRole } from '../types';

export const WRAPPING = WRAPPING_BUTTON;

/** A refusal in our words (FR-6: a 403 is worded, not hidden). */
export function TeamProblem({ refusal }: { refusal: TeamRefusal }) {
  const { t } = useTranslation('team');
  return (
    <WordedRefusal
      message={t(`refused.${refusal.kind}`)}
      english={refusal.kind === 'other' ? refusal.sentence : undefined}
      requestId={'requestId' in refusal ? refusal.requestId : undefined}
    />
  );
}

export function useRoleName() {
  const { t } = useTranslation('team');
  return (role: EventRole | null) => (role ? t(`role.${role}.name`) : t('role.unknown'));
}

interface RoleChoicesProps {
  /** Unique within the page: both the invite form and a dialog can be on screen. */
  idPrefix: string;
  labelledBy: string;
  /** `null` chooses nothing: a role this client doesn't know is never shown as another. */
  value: EventRole | null;
  onChange: (role: EventRole) => void;
  /** Words after one role's name: its current one, in the dialog. */
  mark?: { role: EventRole | null; words: ReactNode };
}

/** The four roles, each saying what it may do, so nobody picks one from its name alone. */
export function RoleChoices({ idPrefix, labelledBy, value, onChange, mark }: RoleChoicesProps) {
  const { t } = useTranslation('team');
  return (
    <RadioGroup
      aria-labelledby={labelledBy}
      value={value ?? ''}
      onValueChange={(next) => {
        const role = roleOf(next);
        if (role) onChange(role);
      }}
      className="gap-3"
    >
      {EVENT_ROLES.map((role) => (
        <div key={role} className="flex min-h-11 items-start gap-3">
          <RadioGroupItem
            value={role}
            id={`${idPrefix}-${role}`}
            aria-describedby={`${idPrefix}-${role}-about`}
            className="mt-1"
          />
          <div className="flex min-w-0 flex-col">
            <Label htmlFor={`${idPrefix}-${role}`} className="font-normal">
              {t(`role.${role}.name`)}
              {mark?.role === role ? <> · {mark.words}</> : null}
            </Label>
            <span id={`${idPrefix}-${role}-about`} className="text-muted-foreground text-sm">
              {t(`role.${role}.about`)}
            </span>
          </div>
        </div>
      ))}
    </RadioGroup>
  );
}
