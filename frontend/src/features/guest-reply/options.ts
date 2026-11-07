import type { BuiltInField, Invitation, RsvpFieldConfig } from '@/features/invitation-renderer';

/**
 * How the invitation asks a built-in question (docs/API.md §4, `rsvpFields`): the host can switch
 * each off, and give dietary and drink fixed choices whose keys are sent in every language. A
 * field the payload does not mention is asked, as free text, as the backend treats it. Sending a
 * switched-off field is refused, so the form never shows one.
 */
export function fieldConfig(
  invitation: Pick<Invitation, 'rsvpFields'>,
  field: BuiltInField,
): RsvpFieldConfig {
  const config = invitation.rsvpFields?.[field];
  return { isEnabled: config?.isEnabled ?? true, options: config?.options ?? null };
}

/** Server limits, from SubmitRsvpDto and the custom answers' rules (docs/API.md §4). */
export const LIMITS = {
  name: 80,
  dietaryNotes: 500,
  drink: 80,
  song: 200,
  message: 1000,
  text: 500,
  longText: 4000,
} as const;
