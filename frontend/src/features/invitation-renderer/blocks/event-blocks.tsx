import { useTranslation } from 'react-i18next';

import { timeLeftUntil } from '@/lib/time';
import { cx, Eyebrow, SectionHeading, TextLink } from '@/ui';

import { Countdown, useMinuteClock } from '../components/countdown';
import { Section, variantOf } from '../components/section';
import { Swatches } from '../components/swatches';
import { Timeline } from '../components/timeline';
import { useRoleLabel, VenueCard } from '../components/venue-card';
import {
  bodyContent,
  countdownData,
  safeExternalUrl,
  swatchColours,
  timelineEntries,
  titledContent,
  venues,
  type Venue,
} from '../schemas';
import type { BlockProps } from './block-props';

/** Hidden once the start has passed (spec §7); the server cannot know, so it decides on the client. */
export function CountdownBlock({ block }: BlockProps) {
  const { t } = useTranslation('invitation');
  const now = useMinuteClock();
  const data = countdownData(block);
  if (!data || (now && timeLeftUntil(data.target, now) === null)) return null;
  const { title } = titledContent(block);
  return (
    <Section columnClassName="gap-5">
      <SectionHeading label={t('countdown.label')} heading={title} isCentred />
      <Countdown
        target={data.target}
        variant={variantOf(block.variant, ['numerals', 'days'])}
        now={now}
      />
    </Section>
  );
}

/** `cards`: stacked on phones, in pairs from 768 px, and on desktop only when there are two. */
export function VenueBlock({ block }: BlockProps) {
  const { t } = useTranslation('invitation');
  const list = venues(block);
  if (list.length === 0) return null;
  const { title } = titledContent(block);
  const isList = variantOf(block.variant, ['cards', 'list']) === 'list';
  return (
    <Section>
      <SectionHeading label={t('venue.label')} heading={title ?? t('venue.heading')} />
      <div
        className={cx(
          'grid',
          isList ? 'gap-0' : 'gap-4 md:grid-cols-2',
          list.length !== 2 && 'lg:grid-cols-1',
        )}
      >
        {list.map((venue, index) => (
          <VenueCard
            key={`${index}-${venue.name}`}
            venue={venue}
            className={isList ? 'border-x-0 border-t-0 bg-transparent px-0 py-5' : undefined}
          />
        ))}
      </div>
    </Section>
  );
}

function DirectionsRow({ venue, href }: { venue: Venue; href: string }) {
  const { t } = useTranslation('invitation');
  const roleLabel = useRoleLabel(venue.role);
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-4">
      <div className="flex min-w-0 flex-col gap-1">
        <Eyebrow>{roleLabel}</Eyebrow>
        <p className="m-0 [overflow-wrap:anywhere]">{venue.name}</p>
      </div>
      <TextLink href={href} isExternal className="inline-flex min-h-(--target-min) items-center">
        {t('map.open')}
      </TextLink>
    </li>
  );
}

/** Links only, never an embedded map (R-19). Hidden when no venue has a map link. */
export function MapBlock({ block }: BlockProps) {
  const { t } = useTranslation('invitation');
  const rows = venues(block).flatMap((venue) => {
    const href = safeExternalUrl(venue.mapUrl);
    return href ? [{ venue, href }] : [];
  });
  if (rows.length === 0) return null;
  const { title } = titledContent(block);
  return (
    <Section>
      <SectionHeading label={t('map.label')} heading={title ?? t('map.heading')} />
      <ul className="divide-hairline border-hairline m-0 list-none divide-y border-y p-0">
        {rows.map((row, index) => (
          <DirectionsRow key={`${index}-${row.venue.name}`} venue={row.venue} href={row.href} />
        ))}
      </ul>
    </Section>
  );
}

export function TimelineBlock({ block }: BlockProps) {
  const { t } = useTranslation('invitation');
  const entries = timelineEntries(block);
  if (entries.length === 0) return null;
  const { title } = titledContent(block);
  const isCompact = variantOf(block.variant, ['vertical', 'compact']) === 'compact';
  return (
    <Section>
      <SectionHeading label={t('timeline.label')} heading={title ?? t('timeline.heading')} />
      <Timeline entries={entries} isCompact={isCompact} />
    </Section>
  );
}

/** Without a title, the guidance itself is set as the heading, as the boards draw it. */
export function DressCodeBlock({ block }: BlockProps) {
  const { t } = useTranslation('invitation');
  const { title, body } = bodyContent(block);
  const colours = swatchColours(block);
  if (!body && colours.length === 0) return null;
  return (
    <Section columnClassName="gap-4">
      <SectionHeading label={t('dressCode.label')} heading={title} />
      {body ? (
        <p className={cx('m-0 whitespace-pre-line', !title && 'type-heading-2 text-heading')}>
          {body}
        </p>
      ) : null}
      <Swatches colours={colours} />
    </Section>
  );
}
