import { useTranslation } from 'react-i18next';

import { destinationText } from '@/features/sending';

import type { ExpectedHousehold } from '../audience';
import { SUMMARY } from './shared';

/** One line of who a send is expected to reach, with the names folded under it (design PD-96). */
export function ExpectedGroup({
  title,
  households,
}: {
  title: string;
  households: readonly ExpectedHousehold[];
}) {
  const { t } = useTranslation('follow-ups');
  const { t: sending } = useTranslation('sending');
  return (
    <li className="flex flex-col gap-1">
      <span>{title}</span>
      {households.length > 0 ? (
        <details className="text-sm">
          <summary className={SUMMARY}>{t('expected.seeWho')}</summary>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {households.map((entry) => {
              const how = entry.destination ? destinationText(entry.destination, sending) : '';
              return (
                <li key={entry.householdId} className="break-words">
                  <span className="font-medium">{entry.household}</span>
                  {how ? <span className="text-muted-foreground"> · {how}</span> : null}
                  {entry.reason ? (
                    <span lang="en" className="text-muted-foreground block">
                      {entry.reason}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}
    </li>
  );
}
