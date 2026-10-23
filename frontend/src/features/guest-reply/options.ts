/**
 * The dietary and drink options (provisional default PD-15, standing in for PQ-1, PQ-2 and BQ-9).
 * These are **sample lists**, the ones drawn on the canvas, until product decides.
 *
 * The server receives the English key in every language, so the host's catering sheet counts one
 * option under one name, not three. The labels are interface strings (`reply:dietary.options.*`).
 * Changing a list is editing this file and the three string files.
 */
export const DIETARY_OPTIONS = [
  'vegetarian',
  'vegan',
  'gluten-free',
  'lactose-free',
  'nut-allergy',
] as const;
export type DietaryOption = (typeof DIETARY_OPTIONS)[number];

export const DRINK_OPTIONS = ['wine', 'champagne', 'spirits', 'non-alcoholic'] as const;
export type DrinkOption = (typeof DRINK_OPTIONS)[number];

export function isDietaryOption(value: string): value is DietaryOption {
  return (DIETARY_OPTIONS as readonly string[]).includes(value);
}

export function isDrinkOption(value: string): value is DrinkOption {
  return (DRINK_OPTIONS as readonly string[]).includes(value);
}

/**
 * Which well-known questions the form asks (PD-16): all of them, all optional, until BQ-4 lets
 * the RSVP block choose. Each is one switch.
 */
export const WELL_KNOWN_QUESTIONS = {
  side: true,
  dietary: true,
  drink: true,
  song: true,
  message: true,
} as const;

/** Server limits, from SubmitRsvpDto and the custom answers' rules (docs/API.md §4). */
export const LIMITS = {
  name: 80,
  dietaryNotes: 500,
  song: 200,
  message: 1000,
  text: 500,
  longText: 4000,
} as const;
