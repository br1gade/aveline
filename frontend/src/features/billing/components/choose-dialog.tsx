import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { bankAddress, leaveForBank } from '@/lib/links';
import { AskFirstDialog, useDialogAction, type DialogContext } from '@/ui/app-form';

import { choosePlan } from '../api';
import { billingRefusalOf, type BillingRefusal } from '../refusals';
import type { ChoiceKind } from '../plans';
import type { PaymentProvider, PlanChoice } from '../types';
import { BillingProblem } from './shared';

/** A plan to choose, or an open invoice's plan to pay again, as far as the question needs it. */
export interface Choice {
  planKey: string;
  name: string;
  price: string;
  kind: ChoiceKind | 'pay';
  /** The bank to send a paid plan to; a free plan names none. */
  provider: PaymentProvider;
}

const NO_BANK_PAGE = new Error('no bank page');

function refusalOf(error: unknown): BillingRefusal {
  return error === NO_BANK_PAGE ? { kind: 'noBank' } : billingRefusalOf(error);
}

interface ChooseDialogProps extends DialogContext {
  choice: Choice;
  /** The pilot's refusal belongs to the page, not this dialog (design PD-127). */
  onPilot: () => void;
}

/** Choosing asks first, and says what happens to what the organization has (design PD-128). */
export function ChooseDialog({ choice, onPilot, ...context }: ChooseDialogProps) {
  const { t } = useTranslation('billing');
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } = useDialogAction(
    context,
    refusalOf,
  );
  const { onClose } = context;
  const isPilot = refusal?.kind === 'pilot';
  useEffect(() => {
    if (!isPilot) return;
    onPilot();
    onClose();
  }, [isPilot, onPilot, onClose]);

  // What is said follows what the backend did: the plan now, at the period's end (FR-135), or the
  // bank's page; the question's guess beforehand may be a page load out of date.
  const confirm = () => {
    let made: PlanChoice = { kind: 'activated' };
    void run(
      async () => {
        made = await choosePlan(browserSession().api, choice.planKey, choice.provider);
        if (made.kind !== 'bank') return;
        const address = bankAddress(made.redirectUrl, window.location.origin);
        if (!address) throw NO_BANK_PAGE;
        leaveForBank(address);
      },
      () => t(`status.${made.kind === 'bank' ? 'leaving' : made.kind}`, { name: choice.name }),
    );
  };
  return (
    <AskFirstDialog
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={t(`choose.${choice.kind}.title`, { name: choice.name })}
      body={t(`choose.${choice.kind}.body`, { name: choice.name, price: choice.price })}
      confirmLabel={t(`choose.${choice.kind}.confirm`)}
      isBusy={isBusy}
      problem={refusal && !isPilot ? <BillingProblem refusal={refusal} /> : null}
      onConfirm={confirm}
    />
  );
}
