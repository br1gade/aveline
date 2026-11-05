import { z } from 'zod';

import { isEmailShaped } from '@/lib/text';

export const REQUEST_KINDS = ['EXPORT', 'ERASURE', 'RECTIFICATION'] as const;

/**
 * `CreateDataSubjectRequestDto`'s limits. Its refusal of an address comes back to the field.
 */
export const privacyRequestSchema = z.object({
  kind: z.enum(REQUEST_KINDS),
  subjectEmail: z.string().trim().max(200).refine(isEmailShaped),
  notes: z.string().trim().max(2000),
});

export type PrivacyRequestValues = z.infer<typeof privacyRequestSchema>;
