import { zodResolver } from '@hookform/resolvers/zod';
import { useRef } from 'react';
import { useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { eventPath, type EventDetail } from '@/features/events';
import { LoadedProblem } from '@/features/sending';
import { isLanguage, SOURCE_LANGUAGE } from '@/lib/i18n';
import { StatusLine } from '@/ui/app-form';

import { defaultFileLanguage } from '../languages';
import type { ExportsData } from '../load';
import { exportSchema, type ExportValues } from '../schemas';
import { EXPORT_FORMATS, type LegacyExport, type Snapshot } from '../types';
import { ExportForm } from './export-form';
import { LegacyList } from './legacy-list';
import { LINK } from './shared';
import { SnapshotList } from './snapshot-list';
import { useExportText } from './use-export-text';
import { useExports } from './use-exports';

function Header({ event }: { event: EventDetail }) {
  const { t } = useTranslation('exports');
  return (
    <>
      <Link to={eventPath(event.id)} className={LINK}>
        {t('back')}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-serif text-[28px] leading-[34px] font-normal">{t('title')}</h1>
        <p className="text-muted-foreground m-0">{event.title}</p>
      </div>
      <p className="m-0">{t('intro')}</p>
    </>
  );
}

/** The form starts at a guest list as a PDF, in the event's language, with email and phone. */
function useExportForm(event: EventDetail) {
  const { i18n } = useTranslation();
  const page = isLanguage(i18n.language) ? i18n.language : SOURCE_LANGUAGE;
  return useForm<ExportValues>({
    resolver: zodResolver(exportSchema),
    defaultValues: {
      kind: 'GUEST_LIST',
      format: 'PDF',
      locale: defaultFileLanguage(event.defaultLocale, page),
      withContacts: true,
    },
  });
}

/** The form, the history and the earlier exports, once the history could be read. */
function ExportsBody({ data, initial }: { data: ExportsData; initial: readonly Snapshot[] }) {
  const { t } = useTranslation('exports');
  const { event } = data;
  const text = useExportText(event.timezone);
  const exports = useExports(event.id, initial, text);
  const form = useExportForm(event);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const prefill = (legacy: LegacyExport) => {
    const format = EXPORT_FORMATS.find((each) => each === legacy.format) ?? 'CSV';
    form.setValue('kind', legacy.kind);
    form.setValue('format', format);
    exports.say(
      t('status.prefilled', { what: t('what', { kind: text.kind(legacy.kind), format }) }),
    );
    headingRef.current?.focus();
  };
  return (
    <>
      <StatusLine statusRef={statusRef}>{exports.status}</StatusLine>
      <ExportForm form={form} exports={exports} text={text} headingRef={headingRef} />
      <SnapshotList exports={exports} text={text} />
      <LegacyList legacy={data.legacy} text={text} onMakeAgain={prefill} />
    </>
  );
}

/**
 * An event's exports (design PD-73): making one, the newest fifty with where each stands, and the
 * earlier ones to make again. Every action is offered to every role, and a 403 is worded when it
 * happens (FR-6); a role that cannot read exports (a designer) is told the page is not theirs.
 */
export function ExportsPage({ data }: { data: ExportsData }) {
  const { t } = useTranslation('exports');
  const { event, snapshots } = data;
  return (
    <section className="flex flex-col gap-6">
      <Header event={event} />
      {snapshots.kind === 'ready' ? (
        <ExportsBody data={data} initial={snapshots.value} />
      ) : (
        <LoadedProblem loaded={snapshots} refusedText={t('refused')} />
      )}
    </section>
  );
}
