import { EventRole, OrganizationRole, PlatformRole } from '@prisma/client';
import { ALL_PERMISSIONS, Actor, can, permissionsFor } from './access-policy';

const staff = (role: PlatformRole): Actor => ({ kind: 'staff', role });
const member = (
  organizationRole: OrganizationRole | null,
  eventRole: EventRole | null = null,
): Actor => ({ kind: 'member', organizationRole, eventRole });
const vendor = (scopes: string[]): Actor => ({ kind: 'vendor', scopes });
const guest = (): Actor => ({ kind: 'guest' });

describe('access policy', () => {
  describe('platform staff', () => {
    it('grants an admin every permission', () => {
      for (const permission of ALL_PERMISSIONS) {
        expect(can(staff(PlatformRole.ADMIN), permission)).toBe(true);
      }
    });

    it('lets a concierge operator run an event on the customer’s behalf', () => {
      expect(can(staff(PlatformRole.SUPPORT), 'operations:read')).toBe(true);
      expect(can(staff(PlatformRole.SUPPORT), 'guest:write')).toBe(true);
      expect(can(staff(PlatformRole.SUPPORT), 'invitation:design')).toBe(true);
    });

    it('withholds destruction and billing from a concierge operator', () => {
      expect(can(staff(PlatformRole.SUPPORT), 'event:delete')).toBe(false);
      expect(can(staff(PlatformRole.SUPPORT), 'billing:read')).toBe(false);
    });

    it('grants a customer-account holder nothing by platform role alone', () => {
      expect(can(staff(PlatformRole.NONE), 'event:read')).toBe(false);
    });
  });

  describe('organization roles', () => {
    it('gives an owner full control including deletion and billing', () => {
      expect(can(member(OrganizationRole.OWNER), 'event:delete')).toBe(true);
      expect(can(member(OrganizationRole.OWNER), 'billing:read')).toBe(true);
      expect(can(member(OrganizationRole.OWNER), 'member:manage')).toBe(true);
    });

    // Requests are matched across every customer, so no customer may act on one.
    it('never gives an owner the power to handle data-subject requests', () => {
      expect(can(member(OrganizationRole.OWNER), 'privacy:manage')).toBe(false);
      expect(can(member(OrganizationRole.OWNER, EventRole.OWNER), 'privacy:manage')).toBe(false);
      expect(can(staff(PlatformRole.ADMIN), 'privacy:manage')).toBe(true);
      expect(can(staff(PlatformRole.SUPPORT), 'privacy:manage')).toBe(false);
    });

    it('lets a manager run events but not delete them', () => {
      expect(can(member(OrganizationRole.MANAGER), 'event:write')).toBe(true);
      expect(can(member(OrganizationRole.MANAGER), 'seating:write')).toBe(true);
      expect(can(member(OrganizationRole.MANAGER), 'event:delete')).toBe(false);
    });

    it('restricts a viewer to reading', () => {
      expect(can(member(OrganizationRole.VIEWER), 'event:read')).toBe(true);
      expect(can(member(OrganizationRole.VIEWER), 'guest:write')).toBe(false);
      expect(can(member(OrganizationRole.VIEWER), 'seating:write')).toBe(false);
    });
  });

  describe('event roles', () => {
    it('lets a coordinator run the event they are assigned to', () => {
      const coordinator = member(null, EventRole.COORDINATOR);
      expect(can(coordinator, 'guest:write')).toBe(true);
      expect(can(coordinator, 'seating:write')).toBe(true);
      expect(can(coordinator, 'operations:read')).toBe(true);
    });

    it('withholds organization-level powers from a coordinator', () => {
      const coordinator = member(null, EventRole.COORDINATOR);
      expect(can(coordinator, 'member:manage')).toBe(false);
      expect(can(coordinator, 'billing:read')).toBe(false);
      expect(can(coordinator, 'event:delete')).toBe(false);
    });

    // The reason DESIGNER exists: a freelance designer must be able to change
    // how the invitation looks without seeing guests' phone numbers.
    it('lets a designer change the invitation', () => {
      const designer = member(null, EventRole.DESIGNER);
      expect(can(designer, 'invitation:design')).toBe(true);
      expect(can(designer, 'invitation:read')).toBe(true);
      expect(can(designer, 'event:read')).toBe(true);
    });

    it('denies a designer guest contact details and vendor fees', () => {
      const designer = member(null, EventRole.DESIGNER);
      expect(can(designer, 'guest:contact:read')).toBe(false);
      expect(can(designer, 'vendor:fee:read')).toBe(false);
      expect(can(designer, 'operations:read')).toBe(false);
    });
  });

  describe('combined roles', () => {
    it('takes the union when a user holds both an org and an event role', () => {
      const both = member(OrganizationRole.VIEWER, EventRole.COORDINATOR);
      expect(can(both, 'seating:write')).toBe(true);
      expect(can(both, 'event:read')).toBe(true);
    });

    it('never escalates beyond what either role grants', () => {
      const both = member(OrganizationRole.VIEWER, EventRole.DESIGNER);
      expect(can(both, 'event:delete')).toBe(false);
      expect(can(both, 'member:manage')).toBe(false);
    });

    it('grants nothing to a user with no roles at all', () => {
      expect(permissionsFor(member(null, null))).toEqual([]);
    });
  });

  describe('non-account actors', () => {
    it('limits a vendor to the scopes on their booking', () => {
      expect(can(vendor(['operations:read']), 'operations:read')).toBe(true);
      expect(can(vendor(['operations:read']), 'guest:contact:read')).toBe(false);
      expect(can(vendor([]), 'operations:read')).toBe(false);
    });

    it('grants a guest no organizer permission', () => {
      for (const permission of ALL_PERMISSIONS) {
        expect(can(guest(), permission)).toBe(false);
      }
    });
  });

  describe('permissionsFor', () => {
    it('returns a sorted, de-duplicated set', () => {
      const permissions = permissionsFor(member(OrganizationRole.MANAGER, EventRole.COORDINATOR));
      expect(permissions).toEqual([...new Set(permissions)].sort());
    });
  });
});
