import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cx, Divider, Eyebrow } from '@/ui';

import { useInvitation, useZoneLabel } from '../context';
import { displayDate, displayTime } from '../format';
import { heroContent, photos } from '../schemas';
import { occasionOf, type BlockMedia, type InvitationBlock } from '../types';
import { ArchFrame } from './arch-frame';
import { InvitationImage } from './invitation-image';

/**
 * The names step down as they lengthen, so a long pair still fits in about three lines (spec §5,
 * HERO). Without a photograph the names are the cover, and are set larger.
 */
function nameSize(names: string, hasPhoto: boolean): string {
  if (names.length > 40) return 'type-display-l';
  if (hasPhoto || names.length > 22) return 'type-display-xl';
  return 'font-serif text-[4rem] leading-[4.25rem] font-light tracking-[-0.01em] lg:text-[5rem] lg:leading-[5.25rem]';
}

interface CoverProps {
  block: InvitationBlock;
  /** Under the date: the cover's Reply, on the desktop open card only. */
  action?: ReactNode;
  className?: string;
  /** Set on the photograph, so only ivory and blush words, and no arch (design PD-34, PD-141). */
  isOverPhoto?: boolean;
}

/** Whether the cover fills the first screen: asked for, and with a photograph to fill it. */
export function isFullBleed(block: InvitationBlock): boolean {
  return block.variant === 'full-bleed' && photos(block).length > 0;
}

/** The photograph behind a full-bleed cover. It is the page's first picture, so it loads at once. */
export function CoverPhoto({ block }: { block: InvitationBlock }) {
  const photo = photos(block)[0];
  if (!photo) return null;
  return (
    <InvitationImage
      photo={photo}
      isEager
      sizes="(min-width: 1024px) 50vw, 100vw"
      className="bg-surface absolute inset-0 block size-full object-cover"
    />
  );
}

function subtitleColour(isOverPhoto: boolean): string {
  return isOverPhoto ? 'text-ivory' : 'text-text-muted';
}

/** The arch with its photograph, the ornament without one, nothing over a full-bleed photograph. */
function CoverMark({
  photo,
  isOverPhoto,
}: {
  photo: BlockMedia | undefined;
  isOverPhoto: boolean;
}) {
  if (isOverPhoto) return null;
  if (!photo) return <div aria-hidden="true" className="bg-ornament h-16 w-px" />;
  return (
    <ArchFrame
      photo={photo}
      isEager
      sizes="(min-width: 1024px) 400px, (min-width: 768px) 340px, 70vw"
      className="w-[70%] max-w-[300px] md:max-w-[340px] lg:w-full lg:max-w-[400px]"
    />
  );
}

/**
 * The HERO block: occasion, the arch photograph or none, the hosts' names as the page's only h1,
 * the date in the event's zone (spec §4.2). On a full-bleed cover the photograph is the header's
 * own (`CoverPhoto`), and this sits on it. Its parts rise on load, from where the server drew them
 * (`cover-rise`, spec §10).
 */
export function Cover({ block, action, className, isOverPhoto = false }: CoverProps) {
  const { t } = useTranslation('invitation');
  const { invitation, zone } = useInvitation();
  const zoneLabel = useZoneLabel();
  const { event } = invitation;
  const content = heroContent(block);
  const photo = isOverPhoto ? undefined : photos(block)[0];
  const names = content.title ?? event.hosts;
  const occasion = t(`occasion.${occasionOf(event.type)}`);

  return (
    <div className={cx('cover-rise flex flex-col items-center text-center', className)}>
      <Eyebrow className={cx('mt-7 mb-5', isOverPhoto && 'text-ivory')}>{occasion}</Eyebrow>
      <CoverMark photo={photo} isOverPhoto={isOverPhoto} />
      <h1
        className={cx(
          'text-heading m-0 mt-7 [overflow-wrap:anywhere]',
          nameSize(names, Boolean(photo) || isOverPhoto),
        )}
      >
        {names}
      </h1>
      {content.subtitle ? (
        <p className={cx('m-0 mt-3 text-base leading-6', subtitleColour(isOverPhoto))}>
          {content.subtitle}
        </p>
      ) : null}
      <Divider className="mt-6 mb-5" />
      {/* One line where it fits: full-width tablets, and the open card from 1280 px. */}
      <p className="text-text m-0 text-[13px] leading-5 font-medium tracking-[0.14em] uppercase [&:lang(ru)]:tracking-normal [&:lang(ru)]:normal-case">
        <span className="block md:inline lg:block xl:inline">
          {displayDate(event.startsAt, zone)}
        </span>
        <span className="hidden md:inline lg:hidden xl:inline"> · </span>
        <span className="block md:inline lg:block xl:inline">
          {displayTime(event.startsAt, zone)} · {zoneLabel}
        </span>
      </p>
      {action ? <div className="mt-8 w-full max-w-[320px]">{action}</div> : null}
    </div>
  );
}
