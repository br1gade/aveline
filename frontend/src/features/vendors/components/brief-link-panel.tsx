import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { copyCapabilityLink, type CopyOutcome } from '@/lib/links';
import { WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';
import { Permitted } from '@/features/permissions';

import { briefUrl } from '../brief-link';
import type { Booking } from '../types';

/** Hands the link to the clipboard and nowhere else; the browser may refuse (design PD-122). */
const copyLink = (token: string) => copyCapabilityLink((origin) => briefUrl(origin, token));

/**
 * The vendor's brief link (docs/API.md §6). It is a credential, so it is never shown on the page,
 * only copied; a role without `vendor:write` isn't given it, and is told whose it is to share.
 * "Make a new link" is for a link that reached someone it shouldn't: the old stops working, and a
 * new one exists that nobody has been sent. Pausing the brief keeps the link (FR-108, PD-192).
 */
export function BriefLinkPanel({
  booking,
  onNewLink,
}: {
  booking: Booking;
  onNewLink: (opener: HTMLElement) => void;
}) {
  const { t } = useTranslation('vendors');
  const headingId = useId();
  const [outcome, setOutcome] = useState<CopyOutcome | null>(null);
  const isEnded = booking.status === 'CANCELLED';
  const token = booking.link.isShown ? booking.link.token : '';
  return (
    <section aria-labelledby={headingId} className="flex max-w-[34rem] flex-col gap-3">
      <h2 id={headingId} className="m-0 text-lg font-medium">
        {t('link.title')}
      </h2>
      <p className="m-0">{t('link.lead')}</p>
      {isEnded ? (
        <p className="m-0">{t('link.ended')}</p>
      ) : (
        <>
          {booking.link.isShown ? null : <p className="m-0">{t('link.hidden')}</p>}
          <div className="flex flex-wrap gap-2">
            {booking.link.isShown ? (
              <Button
                className={WRAPPING_BUTTON}
                onClick={() => void copyLink(token).then(setOutcome)}
              >
                {t('link.copy')}
              </Button>
            ) : null}
            <Permitted to="vendor:write">
              <Button
                variant="outline"
                className={WRAPPING_BUTTON}
                onClick={(click) => {
                  setOutcome(null);
                  onNewLink(click.currentTarget);
                }}
              >
                {t('link.replace')}
              </Button>
            </Permitted>
          </div>
        </>
      )}
      <p role="status" className="m-0 text-sm">
        {outcome ? t(`link.${outcome}`) : ''}
      </p>
    </section>
  );
}
