import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, ButtonLink, cx, EXTERNAL_LINK, Eyebrow, Icon } from '@/ui';

import { useInvitation, useZoneLabel } from '../context';
import { displayTime } from '../format';
import { safeExternalUrl, type Venue } from '../schemas';
import { VENUE_ROLES, type VenueRole } from '../types';

function isVenueRole(value: string): value is VenueRole {
  return (VENUE_ROLES as readonly string[]).includes(value);
}

export function useRoleLabel(role: string): string {
  const { t } = useTranslation('invitation');
  return t(`venue.role.${isVenueRole(role) ? role : 'OTHER'}`);
}

/** Copies the address, and says so for two seconds in a polite live region. */
function CopyAddress({ address }: { address: string }) {
  const { t } = useTranslation('invitation');
  const [wasCopied, setWasCopied] = useState(false);

  useEffect(() => {
    if (!wasCopied) return undefined;
    const timer = setTimeout(() => setWasCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [wasCopied]);

  function copy() {
    navigator.clipboard.writeText(address).then(
      () => setWasCopied(true),
      () => setWasCopied(false),
    );
  }

  return (
    <>
      <Button variant="quiet" onClick={copy} className="px-0">
        <Icon name={wasCopied ? 'check' : 'copy'} />
        {t('venue.copyAddress')}
      </Button>
      <span role="status" className="sr-only">
        {wasCopied ? t('venue.copied') : ''}
      </span>
    </>
  );
}

/**
 * One place to be (spec §5, VENUE): the role, the name and address (in the page's language when
 * the host translated them), the address as selectable text, the arrival time in the event's
 * zone, and the actions.
 */
export function VenueCard({ venue, className }: { venue: Venue; className?: string | undefined }) {
  const { t } = useTranslation('invitation');
  const { zone } = useInvitation();
  const zoneLabel = useZoneLabel();
  const roleLabel = useRoleLabel(venue.role);
  const directions = safeExternalUrl(venue.mapUrl);

  return (
    <article
      className={cx('border-hairline bg-surface-raised flex flex-col gap-2 border p-6', className)}
    >
      <Eyebrow>{roleLabel}</Eyebrow>
      <h3 className="type-heading-2 text-heading m-0 [overflow-wrap:anywhere]">{venue.name}</h3>
      <p className="m-0 [overflow-wrap:anywhere] select-text">{venue.address}</p>
      {venue.arriveAt ? (
        <p className="text-text-muted m-0 flex items-center gap-2 text-sm leading-[22px]">
          <Icon name="clock" />
          {t('venue.arriveBy', { time: displayTime(venue.arriveAt, zone) })} · {zoneLabel}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        {directions ? (
          <ButtonLink href={directions} variant="secondary" {...EXTERNAL_LINK}>
            {t('venue.directions')}
          </ButtonLink>
        ) : null}
        <CopyAddress address={venue.address} />
      </div>
    </article>
  );
}
