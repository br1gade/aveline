import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { EventDetail } from '@/features/events';
import { copyCapabilityLink } from '@/lib/links';

import { guestInvitationUrl } from '../guest-link';
import type { Guest } from '../types';
import type { SaidAbout } from './use-list-dialogs';

/** Copies one guest's personal link; `null` where there is no link to copy yet. */
export type OnCopyLink = (guest: Guest, householdId: string) => void;

/**
 * Copying a guest's personal link, for a guest the host gives it to by hand, such as one with only
 * a phone number (design PD-206, PD-213). Offered while the invitation is published, as before then
 * the link opens nothing. What happened is said on the list's status line, for a screen reader, and
 * beside the button, about that row, as the line is above the screen on a phone and under the
 * toolbar on a desktop (walk of 22 November). The link is never shown.
 */
export function useCopyGuestLink(
  event: EventDetail,
  say: (message: string, about?: SaidAbout | null) => void,
) {
  const { t } = useTranslation('guests');
  const { invitation } = event;
  const slug = invitation?.status === 'PUBLISHED' && !invitation.isExpired ? invitation.slug : null;
  const copy = useCallback(
    (guest: Guest, householdId: string) => {
      if (!slug || !guest.link.isShown) return;
      const { token } = guest.link;
      say('');
      void copyCapabilityLink((origin) => guestInvitationUrl(origin, slug, token)).then((outcome) =>
        say(t(`link.${outcome}`, { name: guest.name }), { householdId, guestId: guest.id }),
      );
    },
    [slug, t, say],
  );
  return slug ? copy : null;
}
