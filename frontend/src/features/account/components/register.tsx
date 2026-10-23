import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { browserSession } from '@/api/session';
import { APP_PATHS, ROUTE_PATHS } from '@/route-paths';

import { registerAndSignIn } from '../flows';
import { problemFrom, type Problem } from '../problems';
import { registerSchema, type RegisterValues } from '../schemas';
import { useFieldText } from '../use-field-text';
import { AccountForm } from './account-form';
import { AccountLayout } from './account-layout';
import { AccountLink } from './account-link';
import { ProblemAlert } from './problem-alert';
import { SubmitButton } from './submit-button';
import { TextInputField } from './text-input-field';

function CheckEmail() {
  const { t } = useTranslation('account');
  return (
    <AccountLayout
      title={t('register.checkEmail.title')}
      footer={<AccountLink to={ROUTE_PATHS.signIn}>{t('links.signIn')}</AccountLink>}
    >
      <p className="m-0">{t('register.checkEmail.body')}</p>
    </AccountLayout>
  );
}

/** A new account goes on to create its organization (docs/API.md §6, "Becoming a tenant"). */
export function Register() {
  const { t } = useTranslation('account');
  const navigate = useNavigate();
  const fieldText = useFieldText();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [isCheckingEmail, setIsCheckingEmail] = useState(false);
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = async (values: RegisterValues) => {
    setProblem(null);
    try {
      const outcome = await registerAndSignIn(browserSession(), values);
      if (outcome === 'check-email') setIsCheckingEmail(true);
      else await navigate(APP_PATHS.welcome);
    } catch (error) {
      setProblem(problemFrom(error));
    }
  };

  if (isCheckingEmail) return <CheckEmail />;
  return (
    <AccountLayout
      title={t('register.title')}
      lead={t('register.lead')}
      footer={<AccountLink to={ROUTE_PATHS.signIn}>{t('links.signIn')}</AccountLink>}
    >
      {problem ? <ProblemAlert problem={problem} refused={() => t('problems.check')} /> : null}
      <AccountForm onSubmit={form.handleSubmit(onSubmit)}>
        <TextInputField
          label={t('fields.name')}
          autoComplete="name"
          error={fieldText(errors.name)}
          {...form.register('name')}
        />
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
          autoComplete="new-password"
          help={t('fields.passwordHelp')}
          error={fieldText(errors.password)}
          {...form.register('password')}
        />
        <SubmitButton isSubmitting={isSubmitting}>
          {isSubmitting ? t('register.submitting') : t('register.submit')}
        </SubmitButton>
      </AccountForm>
    </AccountLayout>
  );
}
