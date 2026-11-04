import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { readPublicEnv } from '@/config/env';
import { WRAPPING_BUTTON } from '@/ui/app-form';
import { Button } from '@/ui/kit/button';

import { briefUrl, isSendableOrigin } from '../brief-link';
import type { Booking } from '../types';

type CopyOutcome = 'copied' | 'refused' | 'unsendable' | null;

/** Hands the link to the clipboard and nowhere else; the browser may refuse (design PD-122). */
async function copyLink(token: string): Promise<CopyOutcome> {
  const origin = readPublicEnv().VITE_PUBLIC_ORIGIN;
  if (!isSendableOrigin(origin, window.location.href)) return 'unsendable';
  try {
    await navigator.clipboard.writeText(briefUrl(origin, token));
    return 'copied';
  } catch {
    return 'refused';
  }
}

/**
 * The vendor's brief link (docs/API.md §6). It is a credential, so it is never shown on the page,
 * only copied; a role without `vendor:write` isn't given it, and is told whose it is to share.
 * "Make a new link" is the only way to withdraw one: the old stops working, and a new one exists
 * that nobody has been sent (FR-108).
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
  const [outcome, setOutcome] = useState<CopyOutcome>(null);
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
          </div>
        </>
      )}
      <p role="status" className="m-0 text-sm">
        {outcome ? t(`link.${outcome}`) : ''}
      </p>
    </section>
  );
}
