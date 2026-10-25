import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { EventDetail } from '@/features/events';

import { guestLanguages, joinableHouseholds, offersSides } from '../form-model';
import type { Household } from '../types';
import type { DialogTarget } from './dialog-target';
import type { GuestOptions } from './guest-fields';
import type { SideNames } from './household-card';

/** The event's own names for its sides, else "Side A" and "Side B"; an unknown side shows nothing. */
export function useSideNames(event: Pick<EventDetail, 'sideALabel' | 'sideBLabel'>): SideNames {
  const { t } = useTranslation('guests');
  const { sideALabel, sideBLabel } = event;
  return useMemo(
    () => ({
      UNKNOWN: '',
      SIDE_A: sideALabel ?? t('side.SIDE_A'),
      SIDE_B: sideBLabel ?? t('side.SIDE_B'),
      SHARED: t('side.SHARED'),
    }),
    [sideALabel, sideBLabel, t],
  );
}

type GuestTarget = Extract<DialogTarget, { kind: 'add' | 'edit' }>;

interface OptionsInput {
  event: EventDetail;
  households: readonly Household[];
  target: GuestTarget;
  /** Whether the list came with contact details; only a new guest asks it of the list. */
  isListContactShown: boolean;
}

/**
 * What the add or edit form offers. Households with a free seat (and the guest's own); the event's
 * languages (and the guest's own); the side when the event names both, or the guest has one.
 */
export function useGuestOptions({
  event,
  households,
  target,
  isListContactShown,
}: OptionsInput): GuestOptions {
  const { t } = useTranslation('guests');
  const sides = useSideNames(event);
  return useMemo(() => {
    const guest = target.kind === 'edit' ? target.guest : null;
    const ownId = target.kind === 'edit' ? target.household.id : undefined;
    const language = guest?.locale ?? '';
    return {
      isContactShown: guest ? guest.contact.isShown : isListContactShown,
      languages: guestLanguages(event.locales, language),
      hasNoLanguage: language === '',
      sides: offersSides(event, guest?.side ?? 'UNKNOWN') ? sides : null,
      households: joinableHouseholds(households, ownId).map((household) => ({
        id: household.id,
        label:
          household.id === ownId
            ? t('fields.currentHousehold', { name: household.name })
            : t('fields.householdOption', {
                name: household.name,
                count: household.seatsAllotted - household.seatsNamed,
              }),
      })),
    };
  }, [event, households, target, isListContactShown, sides, t]);
}
