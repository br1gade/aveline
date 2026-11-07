import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isApiError } from '@/api/errors';
import { browserSession } from '@/api/session';
import { WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { listMembers } from '../api';
import type { MembersPage, OrganizationMember } from '../types';
import { useOrganizationDay, useRoleName } from './shared';

export type MemberAction = 'change' | 'owner' | 'remove';

export type OpenMemberDialog = (
  action: MemberAction,
  member: OrganizationMember,
  revision: number,
  opener: HTMLElement,
) => void;

function MemberRow({
  member,
  revision,
  onOpen,
}: {
  member: OrganizationMember;
  revision: number;
  onOpen: OpenMemberDialog;
}) {
  const { t } = useTranslation('organization');
  const roleName = useRoleName();
  const day = useOrganizationDay();
  const actions: Array<{ action: MemberAction; words: string; label: string }> = [
    {
      action: 'change',
      words: t('members.change'),
      label: t('members.changeFor', { name: member.name }),
    },
    ...(member.role === 'OWNER'
      ? []
      : [
          {
            action: 'owner' as const,
            words: t('members.makeOwner'),
            label: t('members.makeOwnerFor', { name: member.name }),
          },
        ]),
    {
      action: 'remove',
      words: t('members.remove'),
      label: t('members.removeFor', { name: member.name }),
    },
  ];
  return (
    <li className="bg-card border-border flex flex-col gap-2 border px-5 py-4">
      <span className="font-medium break-words">{member.name}</span>
      <p className="m-0 text-sm">
        {t('members.joined', { role: roleName(member.role), date: day(member.joinedAt) })}
      </p>
      <div className="flex flex-wrap gap-2">
        {actions.map(({ action, words, label }) => (
          <Button
            key={action}
            variant="outline"
            className={WRAPPING_BUTTON}
            aria-label={label}
            onClick={(click) => onOpen(action, member, revision, click.currentTarget)}
          >
            {words}
          </Button>
        ))}
      </div>
    </li>
  );
}

/** Later pages, read on request and added below. What the page reloads starts it again. */
function useMorePages(first: MembersPage) {
  const [pages, setPages] = useState<MembersPage[]>([first]);
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const last = pages.at(-1) ?? first;
  const loadMore = async () => {
    if (!last.nextCursor) return;
    setState('loading');
    try {
      const page = await listMembers(browserSession().api, last.nextCursor);
      setPages((held) => [...held, page]);
      setState('idle');
    } catch (error) {
      if (!isApiError(error)) throw error;
      setState('failed');
    }
  };
  // Each row keeps the revision it was read at: a later page's would let a write through for a row
  // that has changed since, which is what a revision is there to stop.
  const rows = pages.flatMap(({ items, accessRevision }) =>
    items.map((member) => ({ member, revision: accessRevision })),
  );
  return { rows, last, state, loadMore };
}

export function MemberList({ first, onOpen }: { first: MembersPage; onOpen: OpenMemberDialog }) {
  const { t } = useTranslation('organization');
  const { rows, last, state, loadMore } = useMorePages(first);
  return (
    <>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {rows.map(({ member, revision }) => (
          <MemberRow key={member.userId} member={member} revision={revision} onOpen={onOpen} />
        ))}
      </ul>
      {last.nextCursor ? (
        <div className="flex flex-col items-start gap-2">
          <Button
            variant="outline"
            className={WRAPPING_BUTTON}
            disabled={state === 'loading'}
            onClick={() => void loadMore()}
          >
            {state === 'loading' ? t('members.loading') : t('members.more')}
          </Button>
          {state === 'failed' ? (
            <p role="alert" className="text-destructive m-0 text-sm">
              {t('members.moreFailed')}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
