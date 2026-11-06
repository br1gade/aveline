import { useTranslation } from 'react-i18next';

import { Button } from '@/ui';
import { saveFile } from '@/ui/save-file';

import { buildCalendarFile } from '../calendar';
import { useInvitation } from '../context';
import type { Venue } from '../schemas';

/**
 * "Add to calendar" under the venues (design C-32, PD-178): a calendar file made in the browser from
 * the event's times and these venues, which a phone offers to add. It holds no link.
 */
export function AddToCalendar({ venues }: { venues: readonly Venue[] }) {
  const { t } = useTranslation('invitation');
  const { invitation } = useInvitation();
  const { slug, event } = invitation;
  const save = () => {
    const file = buildCalendarFile(
      { slug, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, venues },
      new Date(),
    );
    saveFile(new Blob([file], { type: 'text/calendar;charset=utf-8' }), 'event.ics');
  };
  return (
    <Button variant="secondary" onClick={save} className="self-start">
      {t('calendar.add')}
    </Button>
  );
}
