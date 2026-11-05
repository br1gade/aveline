import { z } from 'zod';

import { isEmailShaped } from '@/lib/text';

import { HOST_CHANNELS } from './types';

/** Messages are codes, worded by the form. The backend checks no address (FR-99), so this does. */
export type SuppressionFieldCode = 'required' | 'email' | 'phone' | 'tooLong';

/** A phone number as a guest list stores one: digits, with a leading + and spaces or dashes. */
const PHONE = /^\+?[\d\s()-]{6,}$/;

export const suppressionSchema = z
  .object({
    channel: z.enum(HOST_CHANNELS),
    address: z
      .string()
      .trim()
      .min(1, { error: 'required' satisfies SuppressionFieldCode, abort: true })
      .max(200, { error: 'tooLong' satisfies SuppressionFieldCode }),
  })
  .superRefine(({ channel, address }, ctx) => {
    const isEmail = channel === 'EMAIL';
    const isValid = isEmail ? isEmailShaped(address) : PHONE.test(address);
    if (!isValid) {
      ctx.addIssue({ code: 'custom', path: ['address'], message: isEmail ? 'email' : 'phone' });
    }
  });

export type SuppressionValues = z.infer<typeof suppressionSchema>;
