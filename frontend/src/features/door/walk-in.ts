import { z } from 'zod';

import type { components } from '@/api/schema';
import { NAME_LENGTH } from '@/features/guests';

/** Someone not on the list, added at the door (design PD-148). */
export interface WalkInValues {
  firstName: string;
  lastName: string;
}

const name = (least: number) =>
  z.string().trim().min(least, 'required').max(NAME_LENGTH, 'tooLong');

export const walkInSchema = z.object({ firstName: name(1), lastName: name(0) });

/**
 * A household of their own with one seat: anyone who came with them is a walk-in too, and joining
 * a household needs one of its seats free, which the door can't see.
 */
export function walkInBody({
  firstName,
  lastName,
}: WalkInValues): components['schemas']['AddGuestDto'] {
  const last = lastName.trim();
  return { firstName: firstName.trim(), ...(last ? { lastName: last } : {}), seatsAllotted: 1 };
}

/** As the list will name them, first and last joined. */
export function walkInName({ firstName, lastName }: WalkInValues): string {
  return [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');
}
