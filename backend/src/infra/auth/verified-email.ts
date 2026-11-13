import { Prisma, VerificationPurpose } from '@prisma/client';

/**
 * An account's address is verified once it has spent an email-verification
 * token. One definition, so `/me` and staff grants never disagree on who is.
 */
export const USED_EMAIL_VERIFICATION = {
  purpose: VerificationPurpose.EMAIL_VERIFICATION,
  usedAt: { not: null },
} satisfies Prisma.VerificationTokenWhereInput;
