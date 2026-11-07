import type { PromoCode, PromoCodeWire, PromoKind } from './types';

function kindOf(kind: string): PromoKind {
  return kind === 'FIXED' ? 'FIXED' : 'PERCENT';
}

/** Newest first, as the API lists them; every field named. */
export function readPromoCodes(wire: readonly PromoCodeWire[]): PromoCode[] {
  return wire.map((code) => ({
    id: code.id,
    code: code.code,
    kind: kindOf(code.kind),
    value: code.value,
    eventId: code.eventId,
    eventTitle: code.event?.title ?? null,
    maxRedemptions: code.maxRedemptions,
    redemptions: code.redemptions,
    remaining: code.remaining,
    minOrderMinor: code.minOrderMinor,
    validFrom: code.validFrom,
    validUntil: code.validUntil,
    isActive: code.isActive,
  }));
}
