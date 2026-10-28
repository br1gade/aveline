import { useTranslation } from 'react-i18next';

import type { EventZone } from '@/lib/time';
import { formatEventDay } from '@/lib/time';
import { Button, Eyebrow } from '@/ui';

import type { VenueChoice } from '../attendance';
import { attendingCount } from '../summary';
import type { ReplyRecord } from '../types';

function useSummaryLine(record: ReplyRecord): string | null {
  const { t } = useTranslation('reply');
  const { status } = record.rsvp;
  if (status === 'ATTENDING') return t('summary.attending', { count: attendingCount(record) });
  if (status === 'DECLINED' || status === 'UNDECIDED') return t(`summary.${status}`);
  return null;
}

interface SavedReplyProps {
  record: ReplyRecord;
  /** The venues answered one by one in PER_VENUE, by their names on the page. */
  venues: readonly VenueChoice[];
  /** For each statement, who in the household has agreed to its current wording (PD-52). */
  agreed: readonly string[];
  zone: EventZone;
  /** Opens the form; absent once replies are closed. */
  onChange?: (() => void) | undefined;
}

/** The respondent's answer at each venue, in PER_VENUE (design PD-50). */
function VenueLines({ record, venues }: Pick<SavedReplyProps, 'record' | 'venues'>) {
  const { t } = useTranslation('reply');
  if (venues.length === 0) return null;
  const answers = new Map(record.attendance.venues.map((venue) => [venue.venueId, venue.status]));
  return (
    <ul className="m-0 grid list-none gap-1 p-0">
      {venues.map(({ venueId, label }) => {
        const status = answers.get(venueId) ?? 'PENDING';
        return (
          <li key={venueId}>
            {t('venues.line', {
              venue: label,
              answer: status === 'PENDING' ? t('venues.pending') : t(`household.${status}`),
            })}
          </li>
        );
      })}
    </ul>
  );
}

/** "Your reply: Attending · 3 people", when it was sent, and Change reply (spec §6.2, PD-14). */
export function SavedReply({ record, venues, agreed, zone, onChange }: SavedReplyProps) {
  const { t } = useTranslation('reply');
  const line = useSummaryLine(record);
  if (!line) return null;
  const { respondedAt } = record.rsvp;
  return (
    <div className="grid gap-3">
      <Eyebrow className="text-gold-ink">{t('summary.label')}</Eyebrow>
      <p className="type-heading-2 text-heading m-0">{line}</p>
      <VenueLines record={record} venues={venues} />
      {agreed.map((names) => (
        <p key={names} className="text-ink-muted m-0 text-sm leading-[22px]">
          {t('signature.saved', { names })}
        </p>
      ))}
      {respondedAt ? (
        <p className="text-ink-muted m-0 text-sm leading-[22px]">
          {t('summary.sentOn', { date: formatEventDay(respondedAt, zone) })}
        </p>
      ) : null}
      {onChange ? (
        <Button variant="secondary" className="mt-2 self-start" onClick={onChange}>
          {t('summary.change')}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The confirmation (spec §6.2, PD-36): "Thank you" is the section's heading, this says what was
 * sent. It promises no email, since a household without an address receives none.
 */
export function SentReply({ names, onChange }: { names: readonly string[]; onChange: () => void }) {
  const { t } = useTranslation('reply');
  return (
    <div className="grid gap-3" role="status">
      <p className="type-lead m-0">{t('sent.body')}</p>
      {names.length > 0 ? (
        <p className="m-0">
          {t('sent.comingLabel')}{' '}
          {names.map((name, index) => (
            <span key={`${index}-${name}`} className="whitespace-nowrap">
              {name}
              {index < names.length - 1 ? ', ' : ''}
            </span>
          ))}
        </p>
      ) : null}
      <p className="text-ink-muted m-0 text-sm leading-[22px]">{t('send.reassurance')}</p>
      <Button variant="secondary" className="mt-2 self-start" onClick={onChange}>
        {t('summary.change')}
      </Button>
    </div>
  );
}
