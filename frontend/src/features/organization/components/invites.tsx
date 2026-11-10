import { zodResolver } from '@hookform/resolvers/zod';
import { useId, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import type { Loaded } from '@/api/loaded';
import { browserSession } from '@/api/session';
import { LoadedProblem } from '@/features/sending';
import {
  AppForm,
  SubmitButton,
  TextInputField,
  useLeaveGuard,
  WRAPPING_BUTTON,
  type PageActions,
} from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { Permitted } from '@/features/permissions';

import { inviteMember } from '../api';
import { refusalOf, type OrganizationRefusal } from '../refusals';
import { inviteSchema, type InviteValues } from '../schemas';
import type { OrganizationInvite } from '../types';
import { RoleField } from './role-field';
import { OrganizationProblem, useOrganizationDay, useRoleName } from './shared';

const EMPTY: InviteValues = { email: '', role: 'MEMBER' };

/** Inviting someone. The answer's development link is never read (`api.ts`). */
function InviteForm({ page }: { page: PageActions }) {
  const { t } = useTranslation('organization');
  const headingId = useId();
  const [refusal, setRefusal] = useState<OrganizationRefusal | null>(null);
  const form = useForm<InviteValues>({ resolver: zodResolver(inviteSchema), defaultValues: EMPTY });
  useLeaveGuard(form);
  const send = async (values: InviteValues) => {
    setRefusal(null);
    try {
      const sent = await inviteMember(browserSession().api, values);
      form.reset(EMPTY);
      await page.done(t('status.invited', { email: sent.email }));
    } catch (error) {
      const found = refusalOf(error);
      if (found.kind === 'emailRefused') form.setError('email', { type: 'server' });
      else setRefusal(found);
      if (found.isStale) page.reload();
    }
  };
  const chosen = useWatch({ control: form.control, name: 'role' });
  const { errors, isSubmitting } = form.formState;
  return (
    <section aria-labelledby={headingId} className="flex max-w-[34rem] flex-col gap-3">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('invite.title')}
      </h2>
      <p className="m-0">{t('invite.lead')}</p>
      {refusal ? <OrganizationProblem refusal={refusal} /> : null}
      <AppForm onSubmit={(event) => void form.handleSubmit(send)(event)}>
        <TextInputField
          label={t('invite.email')}
          type="email"
          autoComplete="off"
          error={errors.email ? t('invite.emailError') : undefined}
          {...form.register('email')}
        />
        <RoleField label={t('invite.role')} chosen={chosen} {...form.register('role')} />
        <SubmitButton isSubmitting={isSubmitting} className="w-auto self-start">
          {isSubmitting ? t('invite.sending') : t('invite.send')}
        </SubmitButton>
      </AppForm>
    </section>
  );
}

function InviteRow({
  invite,
  now,
  onWithdraw,
}: {
  invite: OrganizationInvite;
  now: number;
  onWithdraw: (invite: OrganizationInvite, opener: HTMLElement) => void;
}) {
  const { t } = useTranslation('organization');
  const roleName = useRoleName();
  const day = useOrganizationDay();
  return (
    <li className="bg-card border-border flex flex-col gap-2 border px-5 py-4">
      <span className="font-medium break-words">{invite.email}</span>
      <p className="m-0 text-sm">
        {t(Date.parse(invite.expiresAt) < now ? 'invites.expired' : 'invites.line', {
          role: roleName(invite.role),
          date: day(invite.expiresAt),
        })}
      </p>
      <Button
        variant="outline"
        className={`${WRAPPING_BUTTON} self-start`}
        aria-label={t('invites.withdrawFor', { email: invite.email })}
        onClick={(click) => onWithdraw(invite, click.currentTarget)}
      >
        {t('invites.withdraw')}
      </Button>
    </li>
  );
}

export function Invites({
  invites,
  now,
  page,
  onWithdraw,
}: {
  invites: Loaded<OrganizationInvite[]>;
  now: number;
  page: PageActions;
  onWithdraw: (invite: OrganizationInvite, opener: HTMLElement) => void;
}) {
  const { t } = useTranslation('organization');
  const headingId = useId();
  return (
    <>
      <section aria-labelledby={headingId} className="flex max-w-[40rem] flex-col gap-3">
        <h2 id={headingId} className="m-0 text-lg font-medium">
          {t('invites.title')}
        </h2>
        {invites.kind !== 'ready' ? (
          <LoadedProblem loaded={invites} refusedText={t('invites.refused')} />
        ) : null}
        {invites.kind === 'ready' && invites.value.length === 0 ? (
          <p className="m-0">{t('invites.none')}</p>
        ) : null}
        {invites.kind === 'ready' && invites.value.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {invites.value.map((invite) => (
              <InviteRow key={invite.email} invite={invite} now={now} onWithdraw={onWithdraw} />
            ))}
          </ul>
        ) : null}
      </section>
      <Permitted to="member:manage">
        <InviteForm page={page} />
      </Permitted>
    </>
  );
}
