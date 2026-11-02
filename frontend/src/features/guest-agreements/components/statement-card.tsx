import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState } from 'react';
import { useForm, useWatch, type UseFormReturn } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { DrawingPad, SIGNER_NAME_LIMIT, type ReplyLink, type Signee } from '@/features/guest-reply';
import { Button, Notice, useIsHydrated } from '@/ui';
import { ChoiceCard, Chip, Fieldset, TextField } from '@/ui/form';

import { signAgreement } from '../api';
import { isForOthers, type DoorAgreement } from '../door';
import { agreeBody, EMPTY_AGREEMENT, type AgreementValues } from '../payload';
import { agreementRefusal, type AgreementRefusal } from '../refusals';
import { agreementSchema } from '../schemas';
import type { DoorAgreements } from './use-door-agreements';

function names(people: readonly Signee[]): string {
  return people.map((person) => person.name).join(', ');
}

type Form = UseFormReturn<AgreementValues>;

function useError(form: Form, field: keyof AgreementValues): string | undefined {
  const { t } = useTranslation('guest-agreements');
  const message = form.formState.errors[field]?.message;
  return message ? t(`errors.${message}`, { defaultValue: t('errors.agree') }) : undefined;
}

function RefusalText({ refusal }: { refusal: AgreementRefusal }) {
  const { t } = useTranslation('guest-agreements');
  if (refusal.kind === 'refused') {
    return (
      <>
        <p>{t('refusals.refused')}</p>
        <p lang="en">{refusal.sentence}</p>
      </>
    );
  }
  if (refusal.kind === 'failed') {
    return (
      <>
        <p>{t('refusals.failed')}</p>
        {refusal.requestId ? (
          <p>{t('refusals.reference', { requestId: refusal.requestId })}</p>
        ) : null}
      </>
    );
  }
  return <p>{t(`refusals.${refusal.kind}`)}</p>;
}

interface SigningProps {
  form: Form;
  door: DoorAgreements;
  others: Signee[];
  idPrefix: string;
}

/** How the signer signs, once they agree: for the others too, typed or drawn (design PD-52). */
function Signing({ form, door, others, idPrefix }: SigningProps) {
  const { t } = useTranslation('reply');
  const method = useWatch({ control: form.control, name: 'method' });
  const onBehalfError = useError(form, 'isOnBehalf');
  const nameError = useError(form, 'signerName');
  const drawingError = useError(form, 'assetId');
  return (
    <>
      {others.length > 0 ? (
        <div className="grid gap-2">
          <Chip
            label={t('signature.onBehalf', { names: names(others) })}
            {...form.register('isOnBehalf')}
          />
          {onBehalfError ? <p className="text-error m-0 text-sm">{onBehalfError}</p> : null}
        </div>
      ) : null}
      <Fieldset legend={t('signature.method')}>
        {(['TYPED', 'DRAWN'] as const).map((value) => (
          <ChoiceCard
            key={value}
            label={t(`signature.${value}`)}
            value={value}
            {...form.register('method')}
          />
        ))}
      </Fieldset>
      <TextField
        id={`${idPrefix}-name`}
        label={t('signature.signerName')}
        help={method === 'DRAWN' ? t('signature.drawnHelp') : t('signature.typedHelp')}
        autoComplete="name"
        maxLength={SIGNER_NAME_LIMIT}
        error={nameError}
        {...form.register('signerName')}
      />
      {method === 'DRAWN' ? (
        <DrawingPad
          binding={{
            id: `${idPrefix}-drawing`,
            error: drawingError,
            signing: door.signing,
            currentAssetId: () => form.getValues('assetId'),
            setAssetId: (assetId) => form.setValue('assetId', assetId),
            typeInstead: () => form.setValue('method', 'TYPED'),
          }}
        />
      ) : null}
    </>
  );
}

export interface StatementCardProps {
  agreement: DoorAgreement;
  door: DoorAgreements;
  link: ReplyLink;
  signerId: string;
  onAgreed: (people: Signee[]) => void;
}

/** The card's form, and sending it: an old wording reads the agreements again (§11). */
function useStatementForm({ agreement, door, link, signerId, onAgreed }: StatementCardProps) {
  const hasOthers = isForOthers(agreement, signerId);
  const schema = useMemo(() => agreementSchema(hasOthers), [hasOthers]);
  const form = useForm<AgreementValues>({
    resolver: zodResolver(schema),
    defaultValues: EMPTY_AGREEMENT,
  });
  const [refusal, setRefusal] = useState<AgreementRefusal | null>(null);
  const send = async (values: AgreementValues) => {
    setRefusal(null);
    try {
      await signAgreement(door.api, link, agreeBody(values, agreement, signerId));
      onAgreed(agreement.signees);
    } catch (error) {
      const refused = agreementRefusal(error);
      setRefusal(refused);
      if (refused.kind === 'reworded') door.agreed();
    }
  };
  return { form, refusal, send };
}

function Wording({ agreement }: { agreement: DoorAgreement }) {
  const { t } = useTranslation('reply');
  const { statement, signees, agreed } = agreement;
  return (
    <>
      <blockquote lang={statement.locale} className="type-lead m-0 border-l-2 pl-4">
        {statement.prompt}
      </blockquote>
      <p className="m-0">{t('signature.for', { names: names(signees) })}</p>
      {agreed.length > 0 ? (
        <p className="text-ink-muted m-0 text-sm">
          {t('signature.already', { names: names(agreed) })}
        </p>
      ) : null}
    </>
  );
}

/** One statement: its wording quoted in its own language, whom it covers, and agreeing to it. */
export function StatementCard(props: StatementCardProps) {
  const { agreement, door, signerId } = props;
  const { t } = useTranslation('guest-agreements');
  const { t: reply } = useTranslation('reply');
  const isHydrated = useIsHydrated();
  const { form, refusal, send } = useStatementForm(props);
  const isAcknowledged = useWatch({ control: form.control, name: 'isAcknowledged' });
  const agreeError = useError(form, 'isAcknowledged');
  const idPrefix = `door-${agreement.statement.questionId}`;
  const others = agreement.signees.filter((person) => person.guestId !== signerId);
  const { isSubmitting } = form.formState;
  return (
    <form
      method="post"
      noValidate
      className="border-line grid gap-4 border p-5"
      onSubmit={(event) => void form.handleSubmit(send)(event)}
    >
      <Fieldset legend={agreement.statement.required ? t('required') : t('optional')}>
        <Wording agreement={agreement} />
        <Chip
          id={`${idPrefix}-agree`}
          label={reply('signature.agree')}
          {...form.register('isAcknowledged')}
        />
        {agreeError ? <p className="text-error m-0 text-sm">{agreeError}</p> : null}
      </Fieldset>
      {isAcknowledged ? (
        <Signing form={form} door={door} others={others} idPrefix={idPrefix} />
      ) : null}
      {refusal ? (
        <Notice tone="error" role="alert">
          <RefusalText refusal={refusal} />
        </Notice>
      ) : null}
      <Button
        type="submit"
        className="justify-self-start"
        disabled={!isHydrated || isSubmitting}
        aria-busy={isSubmitting}
      >
        {t('submit')}
      </Button>
    </form>
  );
}
