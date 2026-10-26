import { PlatformRole } from '@prisma/client';
import { canAccessEnquiry } from './enquiry-access';

describe('current enquiry standing', () => {
  it.each(Object.values(PlatformRole))('checks live %s and current assignment', (platformRole) => {
    for (const assignedUserId of [null, 'operator', 'other']) {
      const actor = { id: 'operator', platformRole, isActive: true, deletedAt: null };
      expect(canAccessEnquiry(actor, assignedUserId)).toBe(platformRole === 'ADMIN' || (platformRole === 'SUPPORT' && assignedUserId === actor.id));
      expect(canAccessEnquiry({ ...actor, isActive: false }, assignedUserId)).toBe(false);
      expect(canAccessEnquiry({ ...actor, deletedAt: new Date() }, assignedUserId)).toBe(false);
    }
  });
});
