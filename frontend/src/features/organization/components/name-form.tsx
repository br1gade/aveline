import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { forgetSettledOrganization } from '@/features/account';
import {
  AppForm,
  SubmitButton,
  TextInputField,
  useLeaveGuard,
  type PageActions,
} from '@/ui/app-form';

import { renameOrganization } from '../api';
import { refusalOf, type OrganizationRefusal } from '../refusals';
import { renameSchema, type RenameValues } from '../schemas';
import { OrganizationProblem } from './shared';

/** Renaming. The app's frame holds the name for an account with several, so it is read again. */
export function NameForm({ name, page }: { name: string; page: PageActions }) {
  const { t } = useTranslation('organization');
  const headingId = useId();
  const [refusal, setRefusal] = useState<OrganizationRefusal | null>(null);
  const form = useForm<RenameValues>({
    resolver: zodResolver(renameSchema),
    defaultValues: { name },
  });
  useLeaveGuard(form);
  const save = async (values: RenameValues) => {
    setRefusal(null);
    try {
      await renameOrganization(browserSession().api, values.name);
      forgetSettledOrganization();
      form.reset(values);
      await page.done(t('status.renamed'));
    } catch (error) {
      const found = refusalOf(error);
      if (found.kind === 'nameRefused') form.setError('name', { type: 'server' });
      else setRefusal(found);
    }
  };
  const { errors, isSubmitting } = form.formState;
  return (
    <section aria-labelledby={headingId} className="flex max-w-[34rem] flex-col gap-3">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('name.title')}
      </h2>
      {refusal ? <OrganizationProblem refusal={refusal} /> : null}
      <AppForm onSubmit={(event) => void form.handleSubmit(save)(event)}>
        <TextInputField
          label={t('name.label')}
          autoComplete="organization"
          error={errors.name ? t('name.error') : undefined}
          {...form.register('name')}
        />
        <SubmitButton isSubmitting={isSubmitting} className="w-auto self-start">
          {isSubmitting ? t('name.saving') : t('name.save')}
        </SubmitButton>
      </AppForm>
    </section>
  );
}

/** For whom `member:manage` isn't granted (FR-6): the name, with nothing to save. */
export function OrganizationName({ name }: { name: string }) {
  const { t } = useTranslation('organization');
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex max-w-[34rem] flex-col gap-3">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('name.title')}
      </h2>
      <p className="m-0 break-words">{name}</p>
    </section>
  );
}
