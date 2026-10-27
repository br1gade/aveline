import { PlatformRole } from '@prisma/client';
import { parseOrganizationSelector, resolveOrganizationContext } from './organization-context';

function database(memberships: { organizationId: string; role: 'OWNER' | 'VIEWER' }[]) {
  return {
    organizationMembership: {
      findMany: jest.fn().mockResolvedValue(memberships),
      findUnique: jest.fn().mockImplementation(({ where }) => Promise.resolve(memberships.find((row) => row.organizationId === where.userId_organizationId.organizationId) ?? null)),
    },
    organization: { findFirst: jest.fn().mockResolvedValue({ id: 'target' }) },
    event: { findUnique: jest.fn().mockResolvedValue({ organizationId: 'target' }) },
    eventMembership: { findUnique: jest.fn().mockResolvedValue({ role: 'CHECK_IN' }) },
  };
}

describe('organization selection', () => {
  it.each(['', 'two,headers', ' spaced', 'a'.repeat(65), ['first', 'second']])('rejects invalid selector %p', (selector) => {
    expect(() => parseOrganizationSelector({ 'x-aveline-organization-id': selector })).toThrow('organizationId');
  });
  it('rejects repeated raw headers', () => {
    expect(() => parseOrganizationSelector({ 'x-aveline-organization-id': 'one' }, ['X-Aveline-Organization-Id', 'one', 'x-aveline-organization-id', 'one'])).toThrow();
  });
  it.each([0, 2])('refuses implicit organization with %i memberships', async (count) => {
    const tx = database(Array.from({ length: count }, (_, index) => ({ organizationId: `org${index}`, role: 'OWNER' })));
    await expect(resolveOrganizationContext(tx as never, { userId: 'user', platformRole: PlatformRole.NONE, mode: 'required' })).rejects.toThrow();
  });
  it('retains the sole membership fallback', async () => {
    const tx = database([{ organizationId: 'sole', role: 'VIEWER' }]);
    await expect(resolveOrganizationContext(tx as never, { userId: 'user', platformRole: PlatformRole.NONE, mode: 'required' })).resolves.toMatchObject({ organizationId: 'sole', organizationRole: 'VIEWER', source: 'sole-membership' });
  });
  it('preserves an event-only grant and refuses an authorized resource mismatch', async () => {
    const tx = database([]);
    const input = { userId: 'user', platformRole: PlatformRole.NONE, mode: 'event' as const, eventId: 'event' };
    await expect(resolveOrganizationContext(tx as never, input)).resolves.toMatchObject({ organizationId: 'target', access: 'event', organizationRole: null });
    await expect(resolveOrganizationContext(tx as never, { ...input, selector: 'foreign' })).rejects.toThrow('organizationId');
  });
});
