import { z } from 'zod';

import { isEmailShaped } from '@/lib/text';

export const ORGANIZATION_KINDS = ['HOST', 'PLANNER', 'CORPORATE'] as const;

/** `OpenForCustomerDto`'s limits. The backend has the last word on an address. */
export const openSchema = z.object({
  name: z.string().trim().min(2).max(160),
  kind: z.enum(ORGANIZATION_KINDS),
  ownerEmail: z.string().trim().max(200).refine(isEmailShaped),
});

export type OpenValues = z.infer<typeof openSchema>;
