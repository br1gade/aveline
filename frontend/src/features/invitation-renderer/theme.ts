/**
 * The invitation's palette. **A temporary stand-in (design PD-21):** the payload names a palette
 * but carries no colours (BQ-1, BQ-2), so this module maps a name to the design system's themes
 * and holds only "bordeaux" (R-28). Any other name falls back to it, and a host's own `colors`
 * are ignored. The seeded "ivory-gold" therefore renders in bordeaux.
 *
 * Nothing else may be added here. Delete this module and read the colours from the payload once
 * BQ-1 and BQ-2 are answered; it must not outlive them (DESIGN_DECISIONS §1.1, rule 5).
 */

export type PaletteName = 'bordeaux';

export interface InvitationPalette {
  name: PaletteName;
  /** The name the payload asked for, when it was not one this module holds. */
  replaced?: string;
  /** The design-system theme of the cover, the reply band and the footer. */
  coverTheme: 'bordeaux';
  /** The design-system theme of the letter. */
  letterTheme: 'ivory';
}

const PALETTES: Record<PaletteName, Omit<InvitationPalette, 'replaced'>> = {
  bordeaux: { name: 'bordeaux', coverTheme: 'bordeaux', letterTheme: 'ivory' },
};

function isPaletteName(value: unknown): value is PaletteName {
  return typeof value === 'string' && Object.hasOwn(PALETTES, value);
}

/** Reads only `theme.palette`, the field docs/API.md documents (PD-22). */
export function invitationPalette(theme: Record<string, unknown>): InvitationPalette {
  const requested = theme.palette;
  if (isPaletteName(requested)) {
    return PALETTES[requested];
  }
  return typeof requested === 'string'
    ? { ...PALETTES.bordeaux, replaced: requested }
    : PALETTES.bordeaux;
}
