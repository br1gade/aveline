import { Prisma, VenueRole } from '@prisma/client';

/** D17: preparation and exclusively internal timeline venues never appear to guests. */
export const GUEST_FACING_VENUES = {
  role: { not: VenueRole.PREPARATION },
  OR: [{ timeline: { none: { isInternal: true } } }, { timeline: { some: { isInternal: false } } }],
} satisfies Prisma.VenueWhereInput;
