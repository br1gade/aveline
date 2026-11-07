import { useTranslation } from 'react-i18next';

import { yourTables, type TableLine } from '../seating';
import type { InvitationGuest } from '../types';

function useLineText(): (line: TableLine) => string {
  const { t } = useTranslation('invitation');
  return (line) => {
    const where = line.venue
      ? t('personal.table.at', { venue: line.venue, table: line.table })
      : line.table;
    return line.isReservation ? t('personal.table.held', { seat: where }) : where;
  };
}

/**
 * "Your table", on the personal card under the household's names (design PD-71): each of the
 * guest's seats at its venue, and the members of their household who sit apart; when only they are
 * seated, that the guest has no seat yet. Nothing until the hosts publish the seating, nor when
 * nobody in the household has a seat. Server-rendered, like the card.
 */
export function YourTable({ guest }: { guest: InvitationGuest }) {
  const { t } = useTranslation('invitation');
  const lineText = useLineText();
  const tables = yourTables(guest);
  if (!tables) return null;
  return (
    <div className="flex flex-col gap-1 pt-2">
      <p className="text-heading m-0 text-sm leading-[22px] font-medium">
        {t('personal.table.title')}
      </p>
      {tables.own.length > 0 ? (
        <ul className="m-0 flex list-none flex-col p-0 text-sm leading-[22px]">
          {tables.own.map((line, index) => (
            <li key={index}>{lineText(line)}</li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-sm leading-[22px]">{t('personal.table.none')}</p>
      )}
      {tables.others.map((member) => (
        <p key={member.name} className="text-text-muted m-0 text-sm leading-[22px]">
          {t('personal.table.member', {
            name: member.name,
            seats: member.seats.map(lineText).join(' · '),
          })}
        </p>
      ))}
    </div>
  );
}
