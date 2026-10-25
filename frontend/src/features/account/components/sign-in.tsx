import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router';

import { problemFrom, type Problem } from '@/api/problems';
import { browserSession, logIn } from '@/api/session';
import { APP_PATHS, ROUTE_PATHS } from '@/route-paths';
import { AppForm, ProblemAlert, SubmitButton, TextInputField } from '@/ui/app-form';

import { safeNext } from '../safe-next';
import { signInSchema, type SignInValues } from '../schemas';
import { useFieldText } from '../use-field-text';
import { AccountLayout } from './account-layout';
import { AccountLink } from './account-link';

/** A wrong password and an unknown address are the same 401, and say the same thing (API.md §2). */
export function SignIn() {
  const { t } = useTranslation('account');
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const fieldText = useFieldText();
  const [problem, setProblem] = useState<Problem | null>(null);
  const form = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    defaultValues: { email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = async (values: SignInValues) => {
    setProblem(null);
    try {
      const session = browserSession();
      session.start(await logIn(session.publicApi, values));
      await navigate(safeNext(searchParams.get('next')));
    } catch (error) {
      setProblem(problemFrom(error));
    }
  };

  const footer = (
    <>
      <AccountLink to={ROUTE_PATHS.resetPassword}>{t('links.forgotPassword')}</AccountLink>
      <AccountLink to={APP_PATHS.register}>{t('links.register')}</AccountLink>
    </>
  );

  return (
    <AccountLayout title={t('signIn.title')} footer={footer}>
      {problem ? (
        <ProblemAlert
          problem={problem}
          refused={(status) => (status === 401 ? t('signIn.refused') : t('problems.check'))}
        />
      ) : null}
      <AppForm onSubmit={form.handleSubmit(onSubmit)}>
        <TextInputField
          label={t('fields.email')}
          type="email"
          autoComplete="email"
          error={fieldText(errors.email)}
          {...form.register('email')}
        />
        <TextInputField
          label={t('fields.password')}
          type="password"
          autoComplete="current-password"
          error={fieldText(errors.password)}
          {...form.register('password')}
        />
        <SubmitButton isSubmitting={isSubmitting}>
          {isSubmitting ? t('signIn.submitting') : t('signIn.submit')}
        </SubmitButton>
      </AppForm>
    </AccountLayout>
  );
}
