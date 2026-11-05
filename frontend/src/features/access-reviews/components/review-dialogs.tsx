import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { readEveryPage } from '@/api/every-page';
import { browserSession } from '@/api/session';
import { listMembers, type OrganizationMember } from '@/features/organization';
import { AskFirstDialog, SelectField, useDialogAction, type DialogContext } from '@/ui/app-form';
import { Input } from '@/ui/kit/input';
import { Label } from '@/ui/kit/label';
import { NativeSelectOption } from '@/ui/kit/native-select';

import { resolveReview } from '../api';
import { reviewRefusalOf } from '../refusals';
import type { AccessReview, ReviewDecision } from '../types';
import { ReviewProblem, type Who } from './shared';

/** Four pages of fifty: past that, the page says the list stopped early. */
const MEMBER_PAGES = 4;

type Successors =
  | { kind: 'reading' }
  | { kind: 'read'; members: OrganizationMember[]; isComplete: boolean }
  | { kind: 'unread' };

/** Who could own it: its members who aren't owners already. Read only once a handover is asked for. */
function useSuccessors(organizationId: string): Successors {
  const [successors, setSuccessors] = useState<Successors>({ kind: 'reading' });
  useEffect(() => {
    let isCurrent = true;
    const api = browserSession().api;
    readEveryPage((after) => listMembers(api, after, organizationId), MEMBER_PAGES).then(
      ({ items, isComplete }) => {
        const members = items.filter((member) => member.role !== 'OWNER');
        if (isCurrent) setSuccessors({ kind: 'read', members, isComplete });
      },
      () => {
        if (isCurrent) setSuccessors({ kind: 'unread' });
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [organizationId]);
  return successors;
}

function SuccessorField({
  organizationId,
  value,
  onChange,
}: {
  organizationId: string;
  value: string;
  onChange: (userId: string) => void;
}) {
  const { t } = useTranslation('access-reviews');
  const successors = useSuccessors(organizationId);
  if (successors.kind !== 'read') {
    return <p className="m-0 text-sm">{t(`handover.${successors.kind}`)}</p>;
  }
  if (successors.members.length === 0) return <p className="m-0 text-sm">{t('handover.none')}</p>;
  return (
    <SelectField
      label={t('handover.label')}
      help={successors.isComplete ? undefined : t('handover.stopped')}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <NativeSelectOption value="">{t('handover.choose')}</NativeSelectOption>
      {successors.members.map(({ userId, name }) => (
        <NativeSelectOption key={userId} value={userId}>
          {name}
        </NativeSelectOption>
      ))}
    </SelectField>
  );
}

/**
 * Typing the name, or the reference when the name couldn't be read, as nothing reopens a closed
 * organization: beyond the question every step asks.
 */
function TypeTheName({
  isNamed,
  value,
  onChange,
}: {
  isNamed: boolean;
  value: string;
  onChange: (typed: string) => void;
}) {
  const { t } = useTranslation('access-reviews');
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{t(isNamed ? 'close.typeLabel' : 'close.typeReference')}</Label>
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

const sameName = (typed: string, name: string) =>
  typed.trim().toLowerCase() === name.trim().toLowerCase();

interface DecisionDialogProps extends DialogContext {
  review: AccessReview;
  /** The organization's name, or its reference when the name couldn't be read. */
  who: Who;
  decision: ReviewDecision;
}

/**
 * Resolving a review (design PD-176): handing it to a member, closing it, or leaving it as it is. Each
 * asks first; closing also asks for the name, as it can't be undone.
 */
export function DecisionDialog({ review, who, decision, ...context }: DecisionDialogProps) {
  const { t } = useTranslation('access-reviews');
  const [typed, setTyped] = useState('');
  const [successorUserId, setSuccessorUserId] = useState('');
  const { isBusy, refusal, run, onCloseAutoFocus, onOpenChange } = useDialogAction(
    context,
    reviewRefusalOf,
  );
  const isConfirmable =
    (decision !== 'HANDOVER' || successorUserId !== '') &&
    (decision !== 'CLOSE' || sameName(typed, who.text));
  const resolve = () =>
    resolveReview(browserSession().api, review.id, {
      decision,
      expectedRevision: review.revision,
      ...(decision === 'HANDOVER' ? { successorUserId } : {}),
    });
  return (
    <AskFirstDialog
      onOpenChange={onOpenChange}
      onCloseAutoFocus={onCloseAutoFocus}
      title={t(`ask.${decision}.title`, { name: who.text })}
      body={t(`ask.${decision}.body`)}
      confirmLabel={t(`decision.${decision}`)}
      isBusy={isBusy}
      problem={refusal ? <ReviewProblem refusal={refusal} /> : null}
      isConfirmable={isConfirmable}
      onConfirm={() => void run(resolve, t(`status.${decision}`, { name: who.text }))}
    >
      {decision === 'HANDOVER' ? (
        <SuccessorField
          organizationId={review.organizationId}
          value={successorUserId}
          onChange={setSuccessorUserId}
        />
      ) : null}
      {decision === 'CLOSE' ? (
        <TypeTheName isNamed={who.isNamed} value={typed} onChange={setTyped} />
      ) : null}
    </AskFirstDialog>
  );
}
