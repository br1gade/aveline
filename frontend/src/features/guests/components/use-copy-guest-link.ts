import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { EventDetail } from '@/features/events';
import { copyCapabilityLink } from '@/lib/links';

import { guestInvitationUrl } from '../guest-link';
import type { Guest } from '../types';

/** Copies one guest's personal link; `null` where there is no link to copy yet. */
export type OnCopyLink = (guest: Guest) => void;

/**
 * Copying a guest's personal link, for a guest the host gives it to by hand, such as one with only
 * a phone number (design PD-206, PD-213). Offered while the invitation is published, as before then
 * the link opens nothing. What happened is said once, on the list's status line; the link is never
 * shown.
 */
export function useCopyGuestLink(event: EventDetail, say: (message: string) => void) {
  const { t } = useTranslation('guests');
  const { invitation } = event;
  const slug = invitation?.status === 'PUBLISHED' && !invitation.isExpired ? invitation.slug : null;
  const copy = useCallback(
    (guest: Guest) => {
      if (!slug || !guest.link.isShown) return;
      const { token } = guest.link;
      say('');
      void copyCapabilityLink((origin) => guestInvitationUrl(origin, slug, token)).then((outcome) =>
        say(t(`link.${outcome}`, { name: guest.name })),
      );
    },
    [slug, t, say],
  );
  return slug ? copy : null;
}
