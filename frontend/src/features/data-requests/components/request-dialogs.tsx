import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { AskFirstDialog, useDialogAction, type DialogContext } from '@/ui/app-form';
import { Input } from '@/ui/kit/input';
import { Label } from '@/ui/kit/label';

import { carryOut, confirmDelivery, updateRequest } from '../api';
import { requestRefusalOf, type RequestRefusal } from '../refusals';
import type { Carried, DataRequest, RequestStatus } from '../types';
import { RequestProblem } from './shared';

export type AskedStep = 'confirm' | 'reject' | 'close' | 'export' | 'deliver' | 'erase';

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

/** What confirming a step sends: a move, carrying it out, or confirming an export's delivery. */
function stepCall(request: DataRequest, step: AskedStep, onCarried: (carried: Carried) => void) {
  const api = browserSession().api;
  if (step === 'export' || step === 'erase') return carryOut(api, request.id).then(onCarried);
  if (step === 'deliver') {
    // Offered only once an export was made (`steps.ts`); without one, it's a bug, said as one.
    if (!request.exportGenerationId) throw new Error('No export to confirm the delivery of');
    return confirmDelivery(api, request.id, request.exportGenerationId);
  }
  return updateRequest(api, request.id, { status: MOVES[step] });
}

/**
 * A step that asks first (design PD-168, PD-169): saying who the requester is, since that permits
 * carrying it out; rejecting; closing a correction; carrying one out; and confirming an export
 * reached the requester, which closes it (FR-128).
 */
export function StepDialog({ request, step, onCarried, ...context }: StepDialogProps) {
  const { t } = useTranslation('data-requests');
  const [typed, setTyped] = useState('');
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } = useDialogAction<RequestRefusal>(
    context,
    requestRefusalOf,
  );
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
      onConfirm={() => void run(() => stepCall(request, step, onCarried), t(`status.${step}`))}
    >
      {step === 'erase' ? <TypeTheAddress value={typed} onChange={setTyped} /> : null}
    </AskFirstDialog>
  );
}
