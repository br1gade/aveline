import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ReplyLink, Signee } from '@/features/guest-reply';
import { SectionHeading } from '@/ui';

import { StatementCard } from './statement-card';
import type { DoorAgreements } from './use-door-agreements';

/** The section's id, which the personal card's notice links to. */
export const DOOR_SECTION_ID = 'before-the-door';

/**
 * Agreeing before the door, on the personal page (docs/API.md §11, design PD-83): each statement
 * someone coming has not agreed to in its current wording, agreed to on its own, without changing
 * the reply. A ticket holder's emailed link opens here.
 */
export function AgreeBeforeDoor({ door, link }: { door: DoorAgreements; link: ReplyLink }) {
  const { t } = useTranslation('guest-agreements');
  const [done, setDone] = useState<Signee[] | null>(null);
  const { signerId } = door;
  if (!signerId || (door.agreements.length === 0 && !done)) return null;
  const agreed = (people: Signee[]) => {
    setDone(people);
    door.agreed();
  };
  return (
    <div id={DOOR_SECTION_ID} className="flex scroll-mt-6 flex-col gap-6">
      <SectionHeading label={t('label')} heading={t('heading')} />
      <p className="m-0">{t('lead')}</p>
      {done ? (
        <p role="status" className="m-0 font-medium">
          {door.agreements.length === 0
            ? t('all')
            : t('done', { names: done.map((person) => person.name).join(', ') })}
        </p>
      ) : null}
      {door.agreements.map((agreement) => (
        <StatementCard
          key={`${agreement.statement.statementVersionId}-${door.version}`}
          agreement={agreement}
          door={door}
          link={link}
          signerId={signerId}
          onAgreed={agreed}
        />
      ))}
    </div>
  );
}

/** On the personal card: how many required agreements are still to give, and the way to them. */
export function AgreementsNotice({ door }: { door: DoorAgreements }) {
  const { t } = useTranslation('guest-agreements');
  const count = door.agreements.filter((agreement) => agreement.statement.required).length;
  if (count === 0) return null;
  return (
    <p className="m-0 text-sm">
      {t('notice', { count })}{' '}
      <a href={`#${DOOR_SECTION_ID}`} className="text-action underline underline-offset-3">
        {t('noticeLink')}
      </a>
    </p>
  );
}
