import { z } from 'zod';

import { isEmailShaped } from '@/lib/text';

import { ORGANIZATION_ROLES } from './types';

/** The backend's limits (`RenameOrganizationDto`, `InviteMemberDto`). */
export const renameSchema = z.object({ name: z.string().trim().min(2).max(160) });

export type RenameValues = z.infer<typeof renameSchema>;

export const inviteSchema = z.object({
  email: z.string().trim().max(200).refine(isEmailShaped),
  role: z.enum(ORGANIZATION_ROLES),
});

export type InviteValues = z.infer<typeof inviteSchema>;
