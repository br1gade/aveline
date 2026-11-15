import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import {
  AppForm,
  SubmitButton,
  TextInputField,
  type PageActions,
  useLeaveGuard,
  WRAPPING_BUTTON,
} from '@/ui/app-form';

import { grantStaff } from '../api';
import { staffRefusalOf, type StaffFieldRefusal, type StaffRefusal } from '../refusals';
import { grantSchema, type GrantValues, type StaffFieldCode } from '../schemas';
import { RoleChoices, StaffProblem } from './shared';

const EMPTY: GrantValues = { email: '', role: 'SUPPORT' };

const FIELD_REFUSALS: ReadonlySet<StaffRefusal['kind']> = new Set<StaffFieldRefusal>([
  'notFound',
  'unverified',
  'emailRefused',
]);

/** Gives the role. A refusal about the address goes under its field; anything else above the form. */
function useGrant(page: PageActions) {
  const { t } = useTranslation('staff-accounts');
  const [refusal, setRefusal] = useState<StaffRefusal | null>(null);
  const form = useForm<GrantValues>({ resolver: zodResolver(grantSchema), defaultValues: EMPTY });
  useLeaveGuard(form);
  const onSubmit = async (values: GrantValues) => {
    setRefusal(null);
    try {
      const granted = await grantStaff(browserSession().api, values);
      form.reset(EMPTY);
      const role = t(`role.${granted.role}.name`);
      await page.done(t('status.granted', { name: granted.name, role }));
    } catch (error) {
      const found = staffRefusalOf(error);
      if (FIELD_REFUSALS.has(found.kind)) form.setError('email', { message: found.kind });
      else setRefusal(found);
      if (found.isStale) page.reload();
    }
  };
  return { form, refusal, onSubmit };
}

/**
 * Making someone staff, or changing their role (design PD-200). Support comes first and chosen:
 * the lesser role, which is the one a slip should give.
 */
export function GrantForm({ page }: { page: PageActions }) {
  const { t } = useTranslation('staff-accounts');
  const headingId = useId();
  const roleLabelId = useId();
  const { form, refusal, onSubmit } = useGrant(page);
  const { errors, isSubmitting } = form.formState;
  const emailError = errors.email?.message as StaffFieldCode | StaffFieldRefusal | undefined;

  return (
    <section aria-labelledby={headingId} className="flex max-w-[34rem] flex-col gap-3">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('grant.title')}
      </h2>
      <p className="m-0">{t('grant.lead')}</p>
      {refusal ? <StaffProblem refusal={refusal} /> : null}
      <AppForm onSubmit={form.handleSubmit(onSubmit)}>
        <TextInputField
          label={t('grant.email')}
          type="email"
          autoComplete="off"
          error={emailError ? t(`grant.errors.${emailError}`) : undefined}
          {...form.register('email')}
        />
        <div className="flex flex-col gap-2">
          <p id={roleLabelId} className="m-0 text-sm font-medium">
            {t('grant.role')}
          </p>
          <Controller
            control={form.control}
            name="role"
            render={({ field }) => (
              <RoleChoices labelledBy={roleLabelId} value={field.value} onChange={field.onChange} />
            )}
          />
        </div>
        <SubmitButton
          isSubmitting={isSubmitting}
          className={`w-auto self-start ${WRAPPING_BUTTON}`}
          saysWorking
        >
          {t('grant.submit')}
        </SubmitButton>
      </AppForm>
    </section>
  );
}
