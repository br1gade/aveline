import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { Controller, useForm, type Control } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { browserSession } from '@/api/session';
import { APP_PATHS } from '@/route-paths';
import { FieldLegend, FieldSet } from '@/ui/kit/field';
import { Label } from '@/ui/kit/label';
import { RadioGroup, RadioGroupItem } from '@/ui/kit/radio-group';

import { createOrganization } from '../api';
import { problemFrom, type Problem } from '../problems';
import { organizationSchema, type OrganizationValues } from '../schemas';
import { useFieldText } from '../use-field-text';
import { AccountForm } from './account-form';
import { ProblemAlert } from './problem-alert';
import { SubmitButton } from './submit-button';
import { TextInputField } from './text-input-field';

const KINDS = ['HOST', 'PLANNER', 'CORPORATE'] as const;

/** Who the organization is for; it changes only the presentation today (docs/API.md §6). */
function KindChoice({ control }: { control: Control<OrganizationValues> }) {
  const { t } = useTranslation('app');
  const id = useId();
  return (
    <FieldSet className="gap-3">
      <FieldLegend variant="label">{t('welcome.kind.legend')}</FieldLegend>
      <Controller
        control={control}
        name="kind"
        render={({ field }) => (
          <RadioGroup value={field.value} onValueChange={field.onChange} className="gap-1">
            {KINDS.map((kind) => (
              <div key={kind} className="flex min-h-11 items-center gap-3">
                <RadioGroupItem value={kind} id={`${id}-${kind}`} />
                <Label htmlFor={`${id}-${kind}`} className="font-normal">
                  {t(`welcome.kind.${kind}`)}
                </Label>
              </div>
            ))}
          </RadioGroup>
        )}
      />
    </FieldSet>
  );
}

/**
 * The step between registering and everything else: an account with no organization can do
 * nothing (docs/API.md §6). One per account, so a 409 means it exists already: go on to the app.
 */
export function CreateOrganization() {
  const { t } = useTranslation('app');
  const { t: account } = useTranslation('account');
  const navigate = useNavigate();
  const fieldText = useFieldText();
  const [problem, setProblem] = useState<Problem | null>(null);
  const form = useForm<OrganizationValues>({
    resolver: zodResolver(organizationSchema),
    defaultValues: { name: '', kind: 'HOST' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = async (values: OrganizationValues) => {
    setProblem(null);
    try {
      await createOrganization(browserSession().api, values);
      await navigate(APP_PATHS.app);
    } catch (error) {
      const found = problemFrom(error);
      if (found.code === 'refused' && found.status === 409) await navigate(APP_PATHS.app);
      else setProblem(found);
    }
  };

  return (
    <section className="flex max-w-[30rem] flex-col gap-5">
      <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">
        {t('welcome.title')}
      </h1>
      <p className="text-muted-foreground m-0">{t('welcome.lead')}</p>
      {problem ? (
        <ProblemAlert problem={problem} refused={() => account('problems.check')} />
      ) : null}
      <AccountForm onSubmit={form.handleSubmit(onSubmit)} className="gap-5">
        <TextInputField
          label={t('welcome.name')}
          help={t('welcome.nameHelp')}
          autoComplete="organization"
          error={fieldText(errors.name)}
          {...form.register('name')}
        />
        <KindChoice control={form.control} />
        <SubmitButton isSubmitting={isSubmitting} className="w-auto self-start">
          {isSubmitting ? t('welcome.submitting') : t('welcome.submit')}
        </SubmitButton>
      </AccountForm>
    </section>
  );
}
