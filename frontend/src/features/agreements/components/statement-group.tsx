import { useTranslation } from 'react-i18next';

import { formatEventDay, formatEventTime, type EventZone } from '@/lib/time';

import type { AgreementRow, StatementGroup, Wording } from '../group';
import { DrawnSignature } from './drawn-signature';

interface RowProps {
  row: AgreementRow;
  eventId: string;
  zone: EventZone;
}

function Row({ row, eventId, zone }: RowProps) {
  const { t } = useTranslation('agreements');
  const when = `${formatEventDay(row.createdAt, zone)}, ${formatEventTime(row.createdAt, zone)}`;
  const signer = row.signer ?? row.signerName;
  return (
    <li className="border-border flex flex-col gap-1 border-t pt-3">
      <p className="m-0 font-medium break-words">{row.subject ?? t('row.unknownGuest')}</p>
      <p className="m-0 text-sm">
        {row.isOnBehalf ? t('row.onBehalf', { name: signer }) : t('row.self')}
      </p>
      <p className="m-0 text-sm break-words">
        {row.method === 'DRAWN'
          ? t('row.drawn', { name: row.signerName })
          : t('row.typed', { name: row.signerName })}
      </p>
      <p className="text-muted-foreground m-0 text-sm">{t('row.at', { when })}</p>
      {row.hasDrawing ? (
        <DrawnSignature eventId={eventId} acknowledgementId={row.id} signerName={row.signerName} />
      ) : null}
    </li>
  );
}

/** Current, earlier, or, without the design, neither: the wording as guests read it. */
const WORDING_KEYS = {
  true: 'wording.current',
  false: 'wording.earlier',
  null: 'wording.shown',
} as const;

function WordingBlock({
  wording,
  eventId,
  zone,
}: {
  wording: Wording;
  eventId: string;
  zone: EventZone;
}) {
  const { t } = useTranslation('agreements');
  return (
    <section className="flex flex-col gap-3">
      <h3 className="m-0 text-base font-medium">
        {t(WORDING_KEYS[String(wording.isCurrent) as keyof typeof WORDING_KEYS])}
        <span className="text-muted-foreground font-normal">
          {' · '}
          {t('wording.count', { count: wording.rows.length })}
        </span>
      </h3>
      {wording.texts.map((text) => (
        <blockquote
          key={`${text.locale}-${text.text}`}
          lang={text.locale}
          className="border-border m-0 border-l-2 pl-4 break-words whitespace-pre-line"
        >
          {text.text}
        </blockquote>
      ))}
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {wording.rows.map((row) => (
          <Row key={row.id} row={row} eventId={eventId} zone={zone} />
        ))}
      </ul>
    </section>
  );
}

/** A statement the design no longer lists, one nobody agreed to, or not in its current wording. */
function StatementNotes({ group }: { group: StatementGroup }) {
  const { t } = useTranslation('agreements');
  return (
    <>
      {group.isListed === false ? (
        <p className="text-muted-foreground m-0 text-sm">{t('statement.unlisted')}</p>
      ) : null}
      {group.wordings.length === 0 ? <p className="m-0">{t('statement.nobody')}</p> : null}
      {group.wordings.length > 0 && group.hasCurrent === false ? (
        <p className="m-0">{t('statement.noCurrent')}</p>
      ) : null}
    </>
  );
}

/**
 * One statement guests agree to (design PD-66): who agreed to its current wording and to each
 * earlier one, quoted in the languages it was shown in. Only the current wording counts at the
 * door (docs/API.md §11).
 */
export function StatementBlock({
  group,
  eventId,
  zone,
}: {
  group: StatementGroup;
  eventId: string;
  zone: EventZone;
}) {
  const { t } = useTranslation('agreements');
  // Without the design's own words, the newest wording as guests read it heads the statement.
  const shown = group.wordings[0]?.texts[0];
  return (
    <section className="bg-card border-border flex flex-col gap-4 border px-5 py-4">
      <h2
        lang={group.prompt ? undefined : shown?.locale}
        className="m-0 text-lg font-medium break-words"
      >
        {group.prompt ?? shown?.text ?? t('statement.unlisted')}
      </h2>
      <StatementNotes group={group} />
      {group.wordings.map((wording) => (
        <WordingBlock
          key={wording.statementVersionId}
          wording={wording}
          eventId={eventId}
          zone={zone}
        />
      ))}
    </section>
  );
}
