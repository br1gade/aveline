import { useTranslation } from 'react-i18next';

import { ButtonLink, cx, Eyebrow, StatusChip } from '@/ui';

import { useInvitation } from '../context';
import { displayDay } from '../format';
import type { InvitationGuest } from '../types';
import { REPLY_HEADING_ID, type ReplySummary } from './reply-summary';
import { useStatusText } from './status-text';

interface PersonalCardProps {
  guest: InvitationGuest;
  reply: ReplySummary | null;
  /** The Reply button's id, so the reply bar can hide while it is on screen (PD-31). */
  replyButtonId?: string | undefined;
  className?: string;
}

/**
 * Each name whole, and the unnamed seats as one more item: lines break only between them (PD-29).
 * The separator trails its item, so a wrapped line never starts with one.
 */
function HouseholdNames({
  guest,
  saved,
}: {
  guest: InvitationGuest;
  saved: readonly string[] | undefined;
}) {
  const { t } = useTranslation('invitation');
  const names = saved ?? guest.household.members.map((member) => member.name);
  const unnamed = guest.household.seatsAllotted - names.length;
  const items = unnamed > 0 ? [...names, t('personal.seatsToName', { count: unnamed })] : names;
  return (
    <ul className="text-text m-0 flex list-none flex-wrap p-0 text-sm leading-[22px]">
      {items.map((item, index) => (
        <li key={`${index}-${item}`} className="whitespace-nowrap">
          {item}
          {index < items.length - 1 ? (
            <span aria-hidden="true" className="text-text-muted px-1.5">
              ·
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Tells guests the invitation is theirs: their name, their seats, their reply (spec §4.3). Only on
 * personal links. No gendered forms in any language (R-25).
 */
export function PersonalCard({ guest, reply, replyButtonId, className }: PersonalCardProps) {
  const { t } = useTranslation('invitation');
  const { invitation, zone } = useInvitation();
  const statusText = useStatusText(reply);
  const isOpen = invitation.isAcceptingResponses;

  return (
    <article
      className={cx(
        'border-hairline bg-surface-raised text-text flex flex-col gap-3 border p-6',
        className,
      )}
    >
      <Eyebrow>{t('personal.label')}</Eyebrow>
      <h2 className="type-heading-2 text-heading m-0">
        {t('personal.greeting', { name: guest.name })}
      </h2>
      <p className="m-0">{t('personal.welcome')}</p>
      <div className="border-hairline flex flex-col gap-1 border-t pt-3">
        <p className="text-text-muted m-0 text-sm leading-[22px]">
          {t('personal.seats', { count: guest.household.seatsAllotted })}
        </p>
        <HouseholdNames guest={guest} saved={reply?.householdNames} />
      </div>
      {reply && statusText ? (
        <div className="flex flex-col gap-1">
          <StatusChip status={reply.status}>{statusText}</StatusChip>
          {reply.respondedAt ? (
            <p className="text-text-muted m-0 text-sm leading-[22px]">
              {t('personal.repliedOn', { date: displayDay(reply.respondedAt, zone) })}
            </p>
          ) : null}
        </div>
      ) : null}
      {isOpen ? (
        <ButtonLink
          id={replyButtonId}
          href={`#${REPLY_HEADING_ID}`}
          variant={reply ? 'secondary' : 'primary'}
          isBlock
          className="mt-1"
        >
          {reply ? t('personal.changeReply') : t('personal.reply')}
        </ButtonLink>
      ) : null}
    </article>
  );
}
