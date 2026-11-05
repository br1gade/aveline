import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';

import { LoadedProblem } from '@/features/sending';
import { APP_PATHS } from '@/route-paths';
import { WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { Input } from '@/ui/kit/input';

import type { CustomersData } from '../load';
import type { CustomerOrganization } from '../types';
import { LINK, SetUpEventLink } from './customer-new-event';
import { OpenAccount } from './open-account';

/** `ListConciergeOrganizationsDto`'s limit. */
const MAX_SEARCH = 160;

function Row({ organization }: { organization: CustomerOrganization }) {
  const { t } = useTranslation('customers');
  const { id, name, events, owners, pendingOwnerInvites } = organization;
  return (
    <li className="bg-card border-border flex flex-col gap-1 border px-5 py-4">
      <span className="font-medium break-words">{name}</span>
      {owners.length > 0 ? (
        <p className="m-0 text-sm break-words">
          {t('list.owners', { addresses: owners.join(', ') })}
        </p>
      ) : null}
      {pendingOwnerInvites.length > 0 ? (
        <p className="m-0 text-sm break-words">
          {t('list.invited', { addresses: pendingOwnerInvites.join(', ') })}
        </p>
      ) : null}
      <p className="m-0 text-sm">{t('list.events', { count: events })}</p>
      <SetUpEventLink id={id} name={name} />
    </li>
  );
}

function Search({ query }: { query: string }) {
  const { t } = useTranslation('customers');
  const inputId = useId();
  const [, setParams] = useSearchParams();
  const [typed, setTyped] = useState(query);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setParams(typed.trim() ? { q: typed.trim() } : {}, { replace: true });
  };
  return (
    <form role="search" method="get" onSubmit={submit} className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium">
        {t('list.searchLabel')}
      </label>
      <div className="flex flex-wrap gap-2">
        <Input
          id={inputId}
          type="search"
          name="q"
          autoComplete="off"
          maxLength={MAX_SEARCH}
          className="max-w-[24rem] min-w-0 flex-1"
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
        <Button type="submit" variant="outline" className={WRAPPING_BUTTON}>
          {t('list.search')}
        </Button>
      </div>
    </form>
  );
}

function Results({ organizations }: { organizations: CustomerOrganization[] }) {
  const { t } = useTranslation('customers');
  return (
    <>
      {organizations.length === 0 ? <p className="m-0">{t('list.none')}</p> : null}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {organizations.map((organization) => (
          <Row key={organization.id} organization={organization} />
        ))}
      </ul>
    </>
  );
}

/**
 * Aveline's staff finding and opening customers' accounts (docs/API.md §6; design PD-166). A customer
 * who finds the address is told whose page it is, and offered nothing (design PD-164).
 */
export function CustomersPage({ data }: { data: CustomersData }) {
  const { t } = useTranslation('customers');
  const { organizations, query } = data;
  return (
    <section className="flex flex-col gap-6">
      <Link to={APP_PATHS.staff} className={LINK}>
        {t('back')}
      </Link>
      <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('title')}</h1>
      {organizations.kind === 'refused' ? (
        <LoadedProblem loaded={organizations} refusedText={t('refusal.forbidden')} />
      ) : (
        <>
          <OpenAccount />
          <section className="flex max-w-[40rem] flex-col gap-3">
            <h2 className="m-0 text-lg font-medium">{t('list.title')}</h2>
            <Search key={query} query={query} />
            <p className="text-muted-foreground m-0 text-sm">{t('list.limit')}</p>
            {organizations.kind === 'ready' ? (
              <Results organizations={organizations.value} />
            ) : (
              <LoadedProblem loaded={organizations} refusedText={t('refusal.forbidden')} />
            )}
          </section>
        </>
      )}
    </section>
  );
}
