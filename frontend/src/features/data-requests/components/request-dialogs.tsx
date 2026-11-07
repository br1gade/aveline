import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { AskFirstDialog, useDialogAction, type DialogContext } from '@/ui/app-form';
import { Input } from '@/ui/kit/input';
import { Label } from '@/ui/kit/label';

import { carryOut, updateRequest } from '../api';
import { requestRefusalOf, type RequestRefusal } from '../refusals';
import type { Carried, DataRequest, RequestStatus } from '../types';
import { RequestProblem } from './shared';

export type AskedStep = 'confirm' | 'reject' | 'close' | 'export' | 'erase';

const MOVES: Readonly<Record<'confirm' | 'reject' | 'close', RequestStatus>> = {
  confirm: 'IN_PROGRESS',
  reject: 'REJECTED',
  close: 'COMPLETED',
};

interface StepDialogProps extends DialogContext {
  request: DataRequest;
  step: AskedStep;
  onCarried: (carried: Carried) => void;
}

function sameAddress(typed: string, address: string | null): boolean {
  return typed.trim().toLowerCase() === address?.trim().toLowerCase();
}

/** Typing the address, as nothing undoes an erasure, beyond the question every action asks. */
function TypeTheAddress({ value, onChange }: { value: string; onChange: (typed: string) => void }) {
  const { t } = useTranslation('data-requests');
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{t('erase.typeLabel')}</Label>
      <Input
        id={id}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

/**
 * A step that asks first (design PD-168): saying who the requester is, since that permits carrying it
 * out; rejecting; closing a correction; and carrying one out, which can't be recalled.
 */
export function StepDialog({ request, step, onCarried, ...context }: StepDialogProps) {
  const { t } = useTranslation('data-requests');
  const [typed, setTyped] = useState('');
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } = useDialogAction<RequestRefusal>(
    context,
    requestRefusalOf,
  );
  const api = () => browserSession().api;
  const confirmed = () =>
    step === 'export' || step === 'erase'
      ? carryOut(api(), request.id).then(onCarried)
      : updateRequest(api(), request.id, { status: MOVES[step] });
  return (
    <AskFirstDialog
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={t(`${step}.title`, { address: request.subjectEmail ?? t('noAddressWho') })}
      body={t(`${step}.body`)}
      confirmLabel={t(`step.${step}`)}
      isBusy={isBusy}
      problem={refusal ? <RequestProblem refusal={refusal} /> : null}
      isConfirmable={step !== 'erase' || sameAddress(typed, request.subjectEmail)}
      onConfirm={() => void run(confirmed, t(`status.${step}`))}
    >
      {step === 'erase' ? <TypeTheAddress value={typed} onChange={setTyped} /> : null}
    </AskFirstDialog>
  );
}
