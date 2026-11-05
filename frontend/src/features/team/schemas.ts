import { z } from 'zod';

import { isEmailShaped } from '@/lib/text';

import { EVENT_ROLES } from './types';

/** The backend's own limits (`InviteToEventDto`); messages are codes, worded by the form. */
export type TeamFieldCode = 'required' | 'email' | 'tooLong';

export const inviteSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, { error: 'required' satisfies TeamFieldCode, abort: true })
    .max(200, { error: 'tooLong' satisfies TeamFieldCode })
    .refine(isEmailShaped, { error: 'email' satisfies TeamFieldCode }),
  role: z.enum(EVENT_ROLES),
});

export type InviteValues = z.infer<typeof inviteSchema>;
