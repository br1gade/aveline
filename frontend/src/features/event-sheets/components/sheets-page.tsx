import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { eventPath } from '@/features/events';
import { useLanguageName } from '@/lib/i18n';

import { venueChoices, type SheetsData } from '../load';
import type { BarSheet, CateringSheet, Engagement, EventSheets, Playlist } from '../types';

import { answersSheetPath, guestBookPath } from '../paths';

import { LINK, PartOf, Rows, Sheet, SheetHeader } from './parts';

function CateringBody({ sheet }: { sheet: CateringSheet }) {
  const { t } = useTranslation('sheets');
  return (
    <>
      <p className="m-0 text-lg font-medium">{t('catering.covers', { count: sheet.covers })}</p>
      {sheet.requirements.length === 0 ? (
        <p className="m-0">{t('catering.noRequirements')}</p>
      ) : (
        <Rows
          rows={sheet.requirements.map(({ label, count }) => ({
            label,
            value: String(count),
          }))}
        />
      )}
      {sheet.notes.length > 0 ? (
        <>
          <h3 className="m-0 text-base font-medium">{t('catering.notes')}</h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {sheet.notes.map(({ guest, household, note }, position) => (
              <li key={position} className="break-words">
                <span className="font-medium">{guest}</span>
                <span className="text-muted-foreground text-sm"> · {household}</span>
                <span className="block">{note}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

function BarBody({ sheet }: { sheet: BarSheet }) {
  const { t } = useTranslation('sheets');
  if (sheet.preferences.length === 0) return <p className="m-0">{t('bar.none')}</p>;
  return (
    <>
      <p className="m-0">{t('bar.answers', { count: sheet.totalResponses })}</p>
      <Rows
        rows={sheet.preferences.map(({ label, guests, share }) => ({
          label,
          value: t('bar.count', { guests, share }),
        }))}
      />
    </>
  );
}

function PlaylistBody({ playlist }: { playlist: Playlist }) {
  const { t } = useTranslation('sheets');
  if (playlist.tracks.length === 0) return <p className="m-0">{t('playlist.none')}</p>;
  return (
    <Rows
      rows={playlist.tracks.map(({ track, requests }) => ({
        label: track,
        value: t('playlist.requests', { count: requests }),
      }))}
    />
  );
}

function EngagementBody({ engagement }: { engagement: Engagement }) {
  const { t } = useTranslation('sheets');
  const languageName = useLanguageName();
  // Zero also comes back when the count isn't running (FR-111), so it isn't said as a fact.
  if (engagement.totalViews === 0) return <p className="m-0">{t('engagement.none')}</p>;
  return (
    <>
      <p className="m-0 text-lg font-medium">
        {t('engagement.total', { count: engagement.totalViews })}
      </p>
      <Rows
        rows={engagement.byLocale.map(({ locale, views }) => ({
          label: languageName(locale),
          value: String(views),
        }))}
      />
    </>
  );
}

/** The venue choice, in the address; a link each, so it needs no script and survives a reload. */
function VenueChoice({ data, sheets }: { data: SheetsData; sheets: EventSheets }) {
  const { t } = useTranslation('sheets');
  const choices = venueChoices(data.event, sheets);
  const current = data.venue?.venue.id;
  if (choices.length === 0) return null;
  return (
    <nav aria-label={t('venue.label')} className="flex flex-wrap gap-x-4">
      <Link to="?" className={LINK} aria-current={current ? undefined : 'page'}>
        {t('venue.all')}
      </Link>
      {choices.map(({ id, name }) => (
        <Link
          key={id}
          to={`?venue=${encodeURIComponent(id)}`}
          className={LINK}
          aria-current={current === id ? 'page' : undefined}
        >
          {name}
        </Link>
      ))}
    </nav>
  );
}

function Sheets({ data, sheets }: { data: SheetsData; sheets: EventSheets }) {
  const { t } = useTranslation('sheets');
  const venue = data.venue;
  const refused = t('refused');
  const everywhere = venue ? t('venue.everywhere') : undefined;
  const scope = venue ? t('venue.at', { venue: venue.venue.name }) : t('venue.whole');
  return (
    <>
      <VenueChoice data={data} sheets={sheets} />
      <Sheet title={t('catering.title')} note={scope}>
        <PartOf
          read={venue?.catering ?? { kind: 'ready', value: sheets.catering }}
          refused={refused}
        >
          {(sheet) => <CateringBody sheet={sheet} />}
        </PartOf>
      </Sheet>
      <Sheet title={t('bar.title')} note={scope}>
        <PartOf read={venue?.bar ?? { kind: 'ready', value: sheets.bar }} refused={refused}>
          {(sheet) => <BarBody sheet={sheet} />}
        </PartOf>
      </Sheet>
      <Sheet title={t('playlist.title')} {...(everywhere ? { note: everywhere } : {})}>
        <PlaylistBody playlist={sheets.playlist} />
      </Sheet>
      <Sheet title={t('engagement.title')} {...(everywhere ? { note: everywhere } : {})}>
        <EngagementBody engagement={sheets.engagement} />
      </Sheet>
    </>
  );
}

/**
 * What guests' answers add up to, to hand to the venue, the bar and the musician (docs/API.md §6;
 * design PD-131). Numbers, not charts, as the overview's are (PD-42). The answers to the host's
 * own questions and the guest book are pages of their own (PD-144).
 */
export function SheetsPage({ data }: { data: SheetsData }) {
  const { t } = useTranslation('sheets');
  return (
    <section className="flex flex-col gap-5">
      <SheetHeader
        back={t('back')}
        backTo={eventPath(data.event.id)}
        title={t('title')}
        subject={data.event.title}
      />
      <p className="m-0 max-w-[40rem]">{t('lead')}</p>
      <nav aria-label={t('more')} className="flex flex-wrap gap-x-4">
        <Link to={answersSheetPath(data.event.id)} className={LINK}>
          {t('answers.title')}
        </Link>
        <Link to={guestBookPath(data.event.id)} className={LINK}>
          {t('guestBook.title')}
        </Link>
      </nav>
      <PartOf read={data.sheets} refused={t('refused')}>
        {(sheets) => <Sheets data={data} sheets={sheets} />}
      </PartOf>
    </section>
  );
}
