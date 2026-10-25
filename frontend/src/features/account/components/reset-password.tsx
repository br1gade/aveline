import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { problemFrom, type Problem } from '@/api/problems';
import { browserSession } from '@/api/session';
import { ROUTE_PATHS } from '@/route-paths';
import { AppForm, ProblemAlert, SubmitButton, TextInputField } from '@/ui/app-form';

import { confirmPasswordReset, requestPasswordReset } from '../api';
import {
  newPasswordSchema,
  resetRequestSchema,
  type NewPasswordValues,
  type ResetRequestValues,
} from '../schemas';
import { useFieldText } from '../use-field-text';
import { useLinkToken } from '../use-link-token';
import { AccountLayout } from './account-layout';
import { AccountLink } from './account-link';

/** Without a token: ask for a link. With the token from the email: choose the new password. */
export function ResetPassword() {
  const token = useLinkToken();
  return token ? <ChooseNewPassword token={token} /> : <RequestLink />;
}

function Done({ title, body }: { title: string; body: string }) {
  const { t } = useTranslation('account');
  return (
    <AccountLayout
      title={title}
      footer={<AccountLink to={ROUTE_PATHS.signIn}>{t('links.signIn')}</AccountLink>}
    >
      <p className="m-0">{body}</p>
    </AccountLayout>
  );
}

/** The answer is the same for any address: saying otherwise would tell who has an account. */
function RequestLink() {
  const { t } = useTranslation('account');
  const fieldText = useFieldText();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [isSent, setIsSent] = useState(false);
  const form = useForm<ResetRequestValues>({
    resolver: zodResolver(resetRequestSchema),
    defaultValues: { email: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = async ({ email }: ResetRequestValues) => {
    setProblem(null);
    try {
      await requestPasswordReset(browserSession().publicApi, email);
      setIsSent(true);
    } catch (error) {
      setProblem(problemFrom(error));
    }
  };

  if (isSent) {
    return <Done title={t('resetPassword.sent.title')} body={t('resetPassword.sent.body')} />;
  }
  return (
    <AccountLayout
      title={t('resetPassword.title')}
      lead={t('resetPassword.lead')}
      footer={<AccountLink to={ROUTE_PATHS.signIn}>{t('links.signIn')}</AccountLink>}
    >
      {problem ? <ProblemAlert problem={problem} refused={() => t('problems.check')} /> : null}
      <AppForm onSubmit={form.handleSubmit(onSubmit)}>
        <TextInputField
          label={t('fields.email')}
          type="email"
          autoComplete="email"
          error={fieldText(errors.email)}
          {...form.register('email')}
        />
        <SubmitButton isSubmitting={isSubmitting}>
          {isSubmitting ? t('resetPassword.submitting') : t('resetPassword.submit')}
        </SubmitButton>
      </AppForm>
    </AccountLayout>
  );
}

/**
 * A reset ends every session of the account (docs/API.md §2), this browser's included, so the
 * local session is cleared and the other tabs are told.
 */
function ChooseNewPassword({ token }: { token: string }) {
  const { t } = useTranslation('account');
  const fieldText = useFieldText();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [isDone, setIsDone] = useState(false);
  const form = useForm<NewPasswordValues>({
    resolver: zodResolver(newPasswordSchema),
    defaultValues: { password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = async ({ password }: NewPasswordValues) => {
    setProblem(null);
    try {
      const session = browserSession();
      await confirmPasswordReset(session.publicApi, { token, password });
      await session.signOut();
      setIsDone(true);
    } catch (error) {
      setProblem(problemFrom(error));
    }
  };

  if (isDone) {
    return <Done title={t('resetPassword.done.title')} body={t('resetPassword.done.body')} />;
  }
  return (
    <AccountLayout title={t('resetPassword.choose.title')} lead={t('resetPassword.choose.lead')}>
      {problem ? (
        <ProblemAlert
          problem={problem}
          refused={(status) =>
            status === 400 ? (
              <>
                {t('resetPassword.linkInvalid')}{' '}
                <AccountLink to={ROUTE_PATHS.resetPassword} reloadDocument>
                  {t('links.requestNewLink')}
                </AccountLink>
              </>
            ) : (
              t('problems.check')
            )
          }
        />
      ) : null}
      <AppForm onSubmit={form.handleSubmit(onSubmit)}>
        <TextInputField
          label={t('fields.newPassword')}
          type="password"
          autoComplete="new-password"
          help={t('fields.passwordHelp')}
          error={fieldText(errors.password)}
          {...form.register('password')}
        />
        <SubmitButton isSubmitting={isSubmitting}>
          {isSubmitting ? t('resetPassword.choose.submitting') : t('resetPassword.choose.submit')}
        </SubmitButton>
      </AppForm>
    </AccountLayout>
  );
}
