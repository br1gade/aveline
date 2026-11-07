import { useTranslation } from 'react-i18next';

import type { Loaded } from '@/api/loaded';
import { LoadedProblem } from '@/features/sending';
import { Button } from '@/ui/kit/button';

import type { LegacyExport } from '../types';
import { PANEL, WRAP } from './shared';
import type { ExportText } from './use-export-text';

interface LegacyListProps {
  legacy: Loaded<LegacyExport[]>;
  text: ExportText;
  /** Fills the form with this export's kind and format, for the host to choose the rest. */
  onMakeAgain: (legacy: LegacyExport) => void;
}

interface RowProps extends Omit<LegacyListProps, 'legacy'> {
  legacy: LegacyExport;
}

function LegacyRow({ legacy, text, onMakeAgain }: RowProps) {
  const { t } = useTranslation('exports');
  const name = t('what', { kind: text.kind(legacy.kind), format: legacy.format });
  const when = text.moment(legacy.createdAt);
  return (
    <li className="border-border flex flex-col gap-2 border-t py-4 first:border-t-0 first:pt-0 last:pb-0">
      <p className="m-0 font-medium break-words">{name}</p>
      <p className="text-muted-foreground m-0 text-sm">
        {t('legacy.requested', { when })}
        <span className="block">{t('legacy.needed')}</span>
      </p>
      <Button
        variant="outline"
        className={`self-start ${WRAP}`}
        aria-label={t('actionFor', { action: t('legacy.again'), name: `${name}, ${when}` })}
        onClick={() => onMakeAgain(legacy)}
      >
        {t('legacy.again')}
      </Button>
    </li>
  );
}

/**
 * Exports asked for before files were kept (design PD-77). Their download builds today's lists,
 * which would pass for the past, so it is never offered: each can only be made again, and the
 * form asks the language and contact details its record never kept. Nothing when there are none.
 */
export function LegacyList({ legacy, text, onMakeAgain }: LegacyListProps) {
  const { t } = useTranslation('exports');
  if (legacy.kind === 'refused') return null;
  if (legacy.kind === 'ready' && legacy.value.length === 0) return null;
  return (
    <section aria-labelledby="exports-legacy" className={PANEL}>
      <h2 id="exports-legacy" className="m-0 text-lg font-medium">
        {t('legacy.title')}
      </h2>
      {legacy.kind === 'failed' ? (
        <LoadedProblem loaded={legacy} refusedText="" />
      ) : (
        <>
          <p className="m-0 text-sm">{t('legacy.intro')}</p>
          <ul className="m-0 flex list-none flex-col p-0">
            {legacy.value.map((each) => (
              <LegacyRow key={each.id} legacy={each} text={text} onMakeAgain={onMakeAgain} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
