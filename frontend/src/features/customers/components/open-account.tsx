import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useRevalidator } from 'react-router';

import { browserSession } from '@/api/session';
import {
  AppForm,
  SelectField,
  SubmitButton,
  TextInputField,
  useLeaveGuard,
  WordedRefusal,
  WRAPPING_BUTTON,
} from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { NativeSelectOption } from '@/ui/kit/native-select';

import { customerChoices, openForCustomer } from '../api';
import { customerRefusalOf, type CustomerRefusal } from '../refusals';
import { ORGANIZATION_KINDS, openSchema, type OpenValues } from '../schemas';
import type { CustomerChoice, OpenedAccount } from '../types';
import { SetUpEventLink } from './customer-new-event';

const EMPTY: OpenValues = { name: '', kind: 'HOST', ownerEmail: '' };

export function CustomerProblem({ refusal }: { refusal: CustomerRefusal }) {
  const { t } = useTranslation('customers');
  return (
    <WordedRefusal
      message={t(`refusal.${refusal.kind}`)}
      english={refusal.kind === 'other' ? refusal.sentence : undefined}
      requestId={'requestId' in refusal ? refusal.requestId : undefined}
    />
  );
}

interface Choices {
  /** They are that address's alone, so changing it takes them away. */
  address: string;
  items: CustomerChoice[];
  /** `false` when only the first pages could be listed. */
  isComplete: boolean;
}

function useOpenAccount() {
  const { revalidate } = useRevalidator();
  const form = useForm<OpenValues>({ resolver: zodResolver(openSchema), defaultValues: EMPTY });
  useLeaveGuard(form);
  const [refusal, setRefusal] = useState<CustomerRefusal | null>(null);
  const [opened, setOpened] = useState<OpenedAccount | null>(null);
  const [choices, setChoices] = useState<Choices | null>(null);
  const api = () => browserSession().api;

  const refused = async (error: unknown, values: OpenValues, organizationId?: string) => {
    const found = customerRefusalOf(error);
    // A choice no longer the address's is said, and the matches read again (FR-130).
    const isStaleChoice = found.kind === 'gone' && organizationId !== undefined;
    if (found.kind === 'needsChoice' || isStaleChoice) {
      const read = await customerChoices(api(), values.ownerEmail);
      setChoices({ address: values.ownerEmail, ...read });
      if (isStaleChoice) setRefusal(found);
    } else if (found.kind === 'emailRefused') form.setError('ownerEmail', { type: 'server' });
    else if (found.kind === 'nameRefused') form.setError('name', { type: 'server' });
    else setRefusal(found);
  };

  const send = async (values: OpenValues, organizationId?: string) => {
    setRefusal(null);
    setOpened(null);
    try {
      const answer = await openForCustomer(api(), {
        ...values,
        ...(organizationId ? { organizationId } : {}),
      });
      form.reset(EMPTY);
      setChoices(null);
      setOpened(answer);
      void revalidate();
    } catch (error) {
      await refused(error, values, organizationId).catch((failed: unknown) =>
        setRefusal(customerRefusalOf(failed)),
      );
    }
  };
  return { form, refusal, opened, choices, send };
}

/** What opening answered: new, or one the address already owns or is invited to own (FR-130). */
function openedWords({ isExisting, relationship }: OpenedAccount) {
  if (!isExisting) return 'open.invited';
  if (relationship === 'OWNER') return 'open.existingOwner';
  return relationship === 'PENDING_OWNER_INVITE' ? 'open.existingInvited' : 'open.existing';
}

function Opened({ opened }: { opened: OpenedAccount }) {
  const { t } = useTranslation('customers');
  const { id, name } = opened.organization;
  return (
    <div role="status" className="flex flex-col gap-1">
      <p className="m-0">{t(openedWords(opened), { name })}</p>
      <SetUpEventLink id={id} name={name} />
    </div>
  );
}

function Choosing({
  items,
  isComplete,
  onChoose,
}: {
  items: CustomerChoice[];
  isComplete: boolean;
  onChoose: (organizationId: string) => void;
}) {
  const { t } = useTranslation('customers');
  return (
    <div className="flex flex-col gap-2">
      <p role="status" className="m-0">
        {t(items.length > 0 ? 'open.several' : 'open.severalNone')}
      </p>
      {isComplete ? null : <p className="m-0">{t('open.partial')}</p>}
      {items.map(({ id, name, relationship }) => (
        <Button
          key={id}
          variant="outline"
          className={`${WRAPPING_BUTTON} self-start`}
          onClick={() => onChoose(id)}
        >
          {t(relationship === 'OWNER' ? 'open.useOwned' : 'open.useInvited', { name })}
        </Button>
      ))}
    </div>
  );
}

/**
 * Opening a customer's account (docs/API.md §6; design PD-166). Staff don't become members, and the
 * customer sets their own password on accepting. An address already holding several organizations has
 * to say which, and the choice resends the same form.
 */
export function OpenAccount() {
  const { t } = useTranslation('customers');
  const headingId = useId();
  const { form, refusal, opened, choices, send } = useOpenAccount();
  const { errors, isSubmitting } = form.formState;
  const typedAddress = form.watch('ownerEmail').trim();
  return (
    <section aria-labelledby={headingId} className="flex max-w-[34rem] flex-col gap-3">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('open.title')}
      </h2>
      <p className="m-0">{t('open.lead')}</p>
      {opened ? <Opened opened={opened} /> : null}
      {refusal ? <CustomerProblem refusal={refusal} /> : null}
      <AppForm onSubmit={(event) => void form.handleSubmit((values) => send(values))(event)}>
        <TextInputField
          label={t('open.name')}
          autoComplete="off"
          error={errors.name ? t('open.nameError') : undefined}
          {...form.register('name')}
        />
        <SelectField label={t('open.kind')} {...form.register('kind')}>
          {ORGANIZATION_KINDS.map((kind) => (
            <NativeSelectOption key={kind} value={kind}>
              {t(`kind.${kind}`)}
            </NativeSelectOption>
          ))}
        </SelectField>
        <TextInputField
          label={t('open.email')}
          type="email"
          autoComplete="off"
          error={errors.ownerEmail ? t('open.emailError') : undefined}
          {...form.register('ownerEmail')}
        />
        <SubmitButton isSubmitting={isSubmitting} className="w-auto self-start">
          {isSubmitting ? t('open.opening') : t('open.submit')}
        </SubmitButton>
      </AppForm>
      {choices?.address === typedAddress ? (
        <Choosing
          items={choices.items}
          isComplete={choices.isComplete}
          onChoose={(id) => void form.handleSubmit((values) => send(values, id))()}
        />
      ) : null}
    </section>
  );
}
