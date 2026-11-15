import { useTranslation } from 'react-i18next';

import { WordedRefusal } from '@/ui/app-form';
import { Label } from '@/ui/kit/label';
import { RadioGroup, RadioGroupItem } from '@/ui/kit/radio-group';

import type { StaffRefusal } from '../refusals';
import { STAFF_ROLES, type StaffRole } from '../types';

/** A refusal in our words (FR-6: a 403 is worded, not hidden). */
export function StaffProblem({ refusal }: { refusal: StaffRefusal }) {
  const { t } = useTranslation('staff-accounts');
  return (
    <WordedRefusal
      message={t(`refused.${refusal.kind}`)}
      english={refusal.kind === 'other' ? refusal.sentence : undefined}
      requestId={'requestId' in refusal ? refusal.requestId : undefined}
    />
  );
}

function isStaffRole(value: string): value is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(value);
}

/** Both roles, each saying what it may do, so nobody picks one from its name alone. */
export function RoleChoices({
  labelledBy,
  value,
  onChange,
}: {
  labelledBy: string;
  value: StaffRole;
  onChange: (role: StaffRole) => void;
}) {
  const { t } = useTranslation('staff-accounts');
  return (
    <RadioGroup
      aria-labelledby={labelledBy}
      value={value}
      onValueChange={(next) => {
        if (isStaffRole(next)) onChange(next);
      }}
      className="gap-3"
    >
      {STAFF_ROLES.map((role) => (
        <div key={role} className="flex min-h-11 items-start gap-3">
          <RadioGroupItem
            value={role}
            id={`staff-role-${role}`}
            aria-describedby={`staff-role-${role}-about`}
            className="mt-1"
          />
          <div className="flex min-w-0 flex-col">
            <Label htmlFor={`staff-role-${role}`} className="font-normal">
              {t(`role.${role}.name`)}
            </Label>
            <span id={`staff-role-${role}-about`} className="text-muted-foreground text-sm">
              {t(`role.${role}.about`)}
            </span>
          </div>
        </div>
      ))}
    </RadioGroup>
  );
}
