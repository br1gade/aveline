/**
 * The organization's promo codes (docs/API.md §6, "Promo codes"). Interim until FR-1: written from
 * `promo-codes.service.ts` (`describe`). Codes carry no currency (FR-100): amounts are read as AMD,
 * the pilot's (design PD-117).
 */

export type PromoKind = 'PERCENT' | 'FIXED';

export interface PromoCodeWire {
  id: string;
  code: string;
  kind: string;
  value: string;
  eventId: string | null;
  /** On the list only; `null` for a code that applies to every event. */
  event?: { id: string; title: string } | null;
  maxRedemptions: number | null;
  redemptions: number;
  remaining: number | null;
  minOrderMinor: string | null;
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
}

export interface PromoCode {
  id: string;
  code: string;
  kind: PromoKind;
  /** A percentage, or an amount in minor units. */
  value: string;
  eventId: string | null;
  eventTitle: string | null;
  maxRedemptions: number | null;
  redemptions: number;
  /** `null` for a code with no limit. */
  remaining: number | null;
  minOrderMinor: string | null;
  validFrom: string | null;
  validUntil: string | null;
  isActive: boolean;
}

/** Where a code stands now; the server decides at checkout, this only says so. */
export type PromoState = 'active' | 'stopped' | 'notYet' | 'expired' | 'usedUp';
