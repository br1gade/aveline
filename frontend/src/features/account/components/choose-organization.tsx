import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { organizationChoice } from '@/api/session';
import { WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { forgetSettledOrganization } from '../organizations';
import type { OwnOrganization } from '../types';

interface ChooseOrganizationProps {
  organizations: readonly OwnOrganization[];
  currentId: string | undefined;
  /** Where to go once chosen: a safe path of this client. */
  next: string;
}

/** One of the roles we have a word for; a new one the backend adds says nothing. */
function RoleWord({ role }: { role: string | undefined }) {
  const { t, i18n } = useTranslation('app');
  const key = `organizations.role.${role ?? ''}`;
  return role && i18n.exists(`app:${key}`) ? (
    <span className="font-normal">
      {' · '}
      {t(key as 'organizations.role.OWNER')}
    </span>
  ) : null;
}

/**
 * Choosing which organization this tab works in (design PD-138). Per tab, as docs/API.md §6 asks, so
 * a second tab can work in another. The role is a backend word, shown only if it is one we know.
 */
export function ChooseOrganization({ organizations, currentId, next }: ChooseOrganizationProps) {
  const { t } = useTranslation('app');
  const navigate = useNavigate();
  // The next page reads in the new organization; the frame reads again on leaving this page.
  const choose = (organizationId: string) => {
    organizationChoice.choose(organizationId);
    forgetSettledOrganization();
    void navigate(next);
  };
  return (
    <section className="flex max-w-[34rem] flex-col gap-4">
      <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">
        {t('organizations.title')}
      </h1>
      <p className="m-0">{t('organizations.lead')}</p>
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {organizations.map(({ organizationId, name, role }) => (
          <li key={organizationId}>
            <Button
              variant={organizationId === currentId ? 'default' : 'outline'}
              aria-current={organizationId === currentId ? 'true' : undefined}
              className={`${WRAPPING_BUTTON} w-full justify-start text-left`}
              onClick={() => choose(organizationId)}
            >
              <span className="break-words">{name}</span>
              <RoleWord role={role} />
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
