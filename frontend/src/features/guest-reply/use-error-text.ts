import { useTranslation } from 'react-i18next';

import type { ErrorCode } from './form-model';
import type { FieldProblem } from './server-errors';

const KEYS = {
  chooseAnswer: 'errors.chooseAnswer',
  chooseVenue: 'errors.chooseVenue',
  firstName: 'errors.firstName',
  tooLong: 'errors.tooLong',
  required: 'errors.required',
  invalidAnswer: 'errors.invalidAnswer',
  members: 'errors.members',
  party: 'errors.party',
  seats: 'errors.seats',
  agree: 'errors.agree',
  signerName: 'errors.signerName',
  drawing: 'errors.drawing',
  onBehalf: 'errors.onBehalf',
} as const satisfies Record<ErrorCode | FieldProblem['code'], string>;

function isKnownCode(code: string): code is keyof typeof KEYS {
  return Object.hasOwn(KEYS, code);
}

/** The guest's words for an error code, from the form's checks or the server's refusal. */
export function useErrorText(seatsAllotted: number): (code: string) => string {
  const { t } = useTranslation('reply');
  return (code) =>
    isKnownCode(code) ? t(KEYS[code], { count: seatsAllotted }) : t('errors.other');
}
