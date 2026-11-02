import { EventRole, OrganizationRole, PlatformRole } from '@prisma/client';
import { Actor, can } from './access-policy';

/**
 * billing:write moves money and changes what a customer pays for, so it
 * belongs to the organization owner and Aveline's admins, and to nobody who
 * merely runs events (docs/ACCESS_CONTROL.md).
 */
describe('who may read and change billing', () => {
  const member = (organizationRole: OrganizationRole | null, eventRole: EventRole | null = null): Actor =>
    ({ kind: 'member', organizationRole, eventRole });
  const staff = (role: PlatformRole): Actor => ({ kind: 'staff', role });

  it.each([
    { label: 'an organization owner', actor: member(OrganizationRole.OWNER) },
    { label: 'a platform admin', actor: staff(PlatformRole.ADMIN) },
  ])('lets $label read and change billing', ({ actor }) => {
    expect(can(actor, 'billing:read')).toBe(true);
    expect(can(actor, 'billing:write')).toBe(true);
  });

  it.each([
    { label: 'an organization manager', actor: member(OrganizationRole.MANAGER) },
    { label: 'an organization member', actor: member(OrganizationRole.MEMBER) },
    { label: 'an organization viewer', actor: member(OrganizationRole.VIEWER) },
    { label: 'an event owner', actor: member(null, EventRole.OWNER) },
    { label: 'an event coordinator', actor: member(null, EventRole.COORDINATOR) },
    { label: 'an event designer', actor: member(null, EventRole.DESIGNER) },
    { label: 'an event viewer', actor: member(null, EventRole.VIEWER) },
    { label: 'a concierge operator', actor: staff(PlatformRole.SUPPORT) },
    { label: 'a customer account with no membership', actor: staff(PlatformRole.NONE) },
    { label: 'a guest', actor: { kind: 'guest' } },
  ] as { label: string; actor: Actor }[])('refuses $label both billing permissions', ({ actor }) => {
    expect(can(actor, 'billing:read')).toBe(false);
    expect(can(actor, 'billing:write')).toBe(false);
  });
});
