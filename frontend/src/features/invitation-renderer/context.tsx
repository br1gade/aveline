import { createContext, useContext, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { EventZone } from '@/lib/time';

import { intlZoneName, zoneLabelKey } from './format';
import type { ArtworkLoader } from './private-artwork';
import type { Invitation, InvitationBlock } from './types';

export interface InvitationContextValue {
  invitation: Invitation;
  /** The event's zone and the page's language: every date on the page uses both. */
  zone: EventZone;
  /** Fills the RSVP block. The renderer knows nothing about the reply form (feature boundary). */
  renderReply?: ((block: InvitationBlock) => ReactNode) | undefined;
  /** Replaces the reply section's label and heading, as "Thank you" does once sent (PD-36). */
  replyHeading?: string | undefined;
  /** Reads private artwork; absent where nothing can (a test of the page alone). */
  artwork?: ArtworkLoader | undefined;
}

const InvitationContext = createContext<InvitationContextValue | null>(null);

export const InvitationProvider = InvitationContext.Provider;

/** The way this page reads private artwork, if any. */
export function useArtwork(): ArtworkLoader | undefined {
  return useContext(InvitationContext)?.artwork;
}

export function useInvitation(): InvitationContextValue {
  const value = useContext(InvitationContext);
  if (!value) {
    throw new Error('useInvitation must be used inside InvitationPage');
  }
  return value;
}

/** "Yerevan time", translated, or Intl's name for zones without a translation. */
export function useZoneLabel(): string {
  const { t } = useTranslation('invitation');
  const { invitation, zone } = useInvitation();
  const key = zoneLabelKey(zone.timeZone);
  return key ? t(key) : intlZoneName(invitation.event.startsAt, zone);
}
