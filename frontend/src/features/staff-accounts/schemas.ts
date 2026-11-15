import { z } from 'zod';

import { isEmailShaped } from '@/lib/text';

import { STAFF_ROLES } from './types';

/** The backend's own limits (`GrantStaffRoleDto`); messages are codes, worded by the form. */
export type StaffFieldCode = 'required' | 'email' | 'tooLong';

export const grantSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, { error: 'required' satisfies StaffFieldCode, abort: true })
    .max(200, { error: 'tooLong' satisfies StaffFieldCode })
    .refine(isEmailShaped, { error: 'email' satisfies StaffFieldCode }),
  role: z.enum(STAFF_ROLES),
});

export type GrantValues = z.infer<typeof grantSchema>;
