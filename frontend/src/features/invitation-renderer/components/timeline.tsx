import { useInvitation } from '../context';
import { dayKey, displayDay, displayTime } from '../format';
import type { TimelineEntry } from '../schemas';
import { cx, Lozenge } from '@/ui';

interface Day {
  key: string;
  entries: TimelineEntry[];
}

/** Consecutive entries on the same calendar day, in the event's zone. The order is kept. */
function byDay(entries: TimelineEntry[], timeZone: string): Day[] {
  const days: Day[] = [];
  for (const entry of entries) {
    const key = dayKey(entry.occursAt, timeZone);
    const last = days.at(-1);
    if (last?.key === key) {
      last.entries.push(entry);
    } else {
      days.push({ key, entries: [entry] });
    }
  }
  return days;
}

function Entries({ entries, isCompact }: { entries: TimelineEntry[]; isCompact: boolean }) {
  const { zone } = useInvitation();
  return (
    <div className="relative">
      {isCompact ? null : (
        <div aria-hidden="true" className="bg-ornament absolute top-3 bottom-3 left-[84px] w-px" />
      )}
      <ol className={cx('m-0 flex list-none flex-col p-0', isCompact ? 'gap-3' : 'gap-6')}>
        {entries.map((entry, index) => (
          <li
            key={`${index}-${entry.occursAt}`}
            className={cx(
              'grid items-center',
              isCompact
                ? 'grid-cols-[64px_minmax(0,1fr)] gap-4'
                : 'grid-cols-[64px_41px_minmax(0,1fr)]',
            )}
          >
            <span className="type-numeral-m text-heading">{displayTime(entry.occursAt, zone)}</span>
            {isCompact ? null : <Lozenge className="justify-self-center" />}
            <span className="[overflow-wrap:anywhere]">{entry.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The running order (spec §5, TIMELINE): `vertical` along a gold line, or `compact`. Entries on
 * more than one day get a heading per day. No venue per entry: the page cannot match one (B33).
 */
export function Timeline({ entries, isCompact }: { entries: TimelineEntry[]; isCompact: boolean }) {
  const { zone } = useInvitation();
  const days = byDay(entries, zone.timeZone);
  if (days.length < 2) {
    return <Entries entries={entries} isCompact={isCompact} />;
  }
  return (
    <div className="flex flex-col gap-8">
      {days.map((day) => (
        <div key={day.key} className="flex flex-col gap-4">
          <h3 className="type-eyebrow text-label m-0 uppercase [&:lang(ru)]:normal-case">
            {displayDay(day.entries[0]?.occursAt ?? day.key, zone)}
          </h3>
          <Entries entries={day.entries} isCompact={isCompact} />
        </div>
      ))}
    </div>
  );
}
