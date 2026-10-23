import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { ROUTE_PATHS } from '@/route-paths';

import { acceptInvite } from '../api';
import { problemFrom, type Problem } from '../problems';
import { acceptInviteSchema, type AcceptInviteValues } from '../schemas';
import type { InviteAccepted, InviteKind } from '../types';
import { useFieldText } from '../use-field-text';
import { useLinkToken } from '../use-link-token';
import { AccountForm } from './account-form';
import { AccountLayout } from './account-layout';
import { AccountLink } from './account-link';
import { ProblemAlert } from './problem-alert';
import { SubmitButton } from './submit-button';
import { TextInputField } from './text-input-field';

const signInLink = (label: string) => <AccountLink to={ROUTE_PATHS.signIn}>{label}</AccountLink>;

/**
 * An invitation into an organization (`/accept-invite`) or onto one event (`/accept-event-invite`).
 * Accepting creates the account if there is none. No session comes back and the address is not
 * shown, so the person signs in afterwards (FR-23).
 */
export function AcceptInvite({ kind }: { kind: InviteKind }) {
  const { t } = useTranslation('account');
  const token = useLinkToken();
  const [accepted, setAccepted] = useState<InviteAccepted | null>(null);

  if (accepted) {
    return (
      <AccountLayout title={t('invite.done.title')} footer={signInLink(t('links.signIn'))}>
        <p className="m-0">
          {accepted.accountCreated ? t('invite.done.created') : t('invite.done.existing')}
        </p>
      </AccountLayout>
    );
  }
  return (
    <AccountLayout
      title={t(`invite.title.${kind}`)}
      lead={token ? t('invite.lead') : undefined}
      footer={signInLink(t('links.signIn'))}
    >
      {token ? (
        <AcceptForm kind={kind} token={token} onAccepted={setAccepted} />
      ) : (
        <p className="m-0">{t('invite.missing')}</p>
      )}
    </AccountLayout>
  );
}

interface AcceptFormProps {
  kind: InviteKind;
  token: string;
  onAccepted: (result: InviteAccepted) => void;
}

function AcceptForm({ kind, token, onAccepted }: AcceptFormProps) {
  const { t } = useTranslation('account');
  const fieldText = useFieldText();
  const [problem, setProblem] = useState<Problem | null>(null);
  const form = useForm<AcceptInviteValues>({
    resolver: zodResolver(acceptInviteSchema),
    defaultValues: { name: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = async (values: AcceptInviteValues) => {
    setProblem(null);
    try {
      onAccepted(await acceptInvite(browserSession().publicApi, kind, { token, ...values }));
    } catch (error) {
      setProblem(problemFrom(error));
    }
  };

  const refused = (status: number) => {
    if (status === 400) return t('invite.invalid');
    if (status !== 409) return t('problems.check');
    return (
      <>
        {t('invite.accountExists')}{' '}
        <AccountLink to={ROUTE_PATHS.resetPassword}>{t('links.forgotPassword')}</AccountLink>
      </>
    );
  };

  return (
    <>
      {problem ? <ProblemAlert problem={problem} refused={refused} /> : null}
      <AccountForm onSubmit={form.handleSubmit(onSubmit)}>
        <TextInputField
          label={t('fields.name')}
          autoComplete="name"
          error={fieldText(errors.name)}
          {...form.register('name')}
        />
        <TextInputField
          label={t('fields.password')}
          type="password"
          autoComplete="new-password"
          help={t('fields.passwordHelp')}
          error={fieldText(errors.password)}
          {...form.register('password')}
        />
        <SubmitButton isSubmitting={isSubmitting}>
          {isSubmitting ? t('invite.submitting') : t('invite.submit')}
        </SubmitButton>
      </AccountForm>
    </>
  );
}
