import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { browserSession } from '@/api/session';
import { AppForm, SubmitButton, TextInputField, type PageActions } from '@/ui/app-form';

import { inviteToTeam } from '../api';
import { refusalOf, type TeamRefusal } from '../refusals';
import { inviteSchema, type InviteValues, type TeamFieldCode } from '../schemas';
import { RoleChoices, TeamProblem, WRAPPING } from './shared';

const EMPTY: InviteValues = { email: '', role: 'COORDINATOR' };

/** Sends the invitation. A refused address goes under its field; anything else above the form. */
function useInvite(eventId: string, page: PageActions) {
  const { t } = useTranslation('team');
  const [refusal, setRefusal] = useState<TeamRefusal | null>(null);
  const form = useForm<InviteValues>({ resolver: zodResolver(inviteSchema), defaultValues: EMPTY });
  const onSubmit = async (values: InviteValues) => {
    setRefusal(null);
    try {
      const sent = await inviteToTeam(browserSession().api, eventId, values);
      form.reset(EMPTY);
      await page.done(t('status.invited', { email: sent.email }));
    } catch (error) {
      const found = refusalOf(error);
      if (found.kind === 'emailRefused') form.setError('email', { message: 'email' });
      else setRefusal(found);
      if (found.isStale) page.reload();
    }
  };
  return { form, refusal, onSubmit };
}

/**
 * Inviting someone by email (design PD-99). Coordinator comes first and chosen, as door staff are
 * who is invited most: it is the only role that can work the door, and the form says what else it
 * gives them (PQ-15). The answer's development link is never read (`read.ts`).
 */
export function InviteForm({ eventId, page }: { eventId: string; page: PageActions }) {
  const { t } = useTranslation('team');
  const headingId = useId();
  const roleLabelId = useId();
  const { form, refusal, onSubmit } = useInvite(eventId, page);
  const { errors, isSubmitting } = form.formState;
  const emailError = errors.email?.message as TeamFieldCode | undefined;

  return (
    <section aria-labelledby={headingId} className="flex max-w-[34rem] flex-col gap-3">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('invite.title')}
      </h2>
      <p className="m-0">{t('invite.lead')}</p>
      {refusal ? <TeamProblem refusal={refusal} /> : null}
      <AppForm onSubmit={form.handleSubmit(onSubmit)}>
        <TextInputField
          label={t('invite.email')}
          type="email"
          autoComplete="off"
          error={emailError ? t(`invite.errors.${emailError}`) : undefined}
          {...form.register('email')}
        />
        <div className="flex flex-col gap-2">
          <p id={roleLabelId} className="m-0 text-sm font-medium">
            {t('invite.role')}
          </p>
          <Controller
            control={form.control}
            name="role"
            render={({ field }) => (
              <RoleChoices
                idPrefix="invite-role"
                labelledBy={roleLabelId}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
          <p className="text-muted-foreground m-0 text-sm">{t('invite.doorHelp')}</p>
        </div>
        <SubmitButton isSubmitting={isSubmitting} className={`w-auto self-start ${WRAPPING}`}>
          {isSubmitting ? t('invite.sending') : t('invite.send')}
        </SubmitButton>
      </AppForm>
    </section>
  );
}
