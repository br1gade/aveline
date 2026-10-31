import { ConfigService } from '@nestjs/config';
import { OrganizationRole, PlatformRole } from '@prisma/client';
import { AccountService } from '../../../src/infra/auth/account.service';
import { CommunicationsService } from '../../../src/modules/communications/communications.service';
import { SuppressionService } from '../../../src/modules/communications/suppression.service';
import { ConciergeService } from '../../../src/modules/organizations/concierge.service';
import { EventsService } from '../../../src/modules/events/events.service';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const prisma = testPrisma();
const database = prisma as PrismaService;
const communications = new CommunicationsService(database, new Map(), new SuppressionService(database));
const accounts = new AccountService(
  database,
  communications,
  new ConfigService({ NODE_ENV: 'test', DEFAULT_LOCALE: 'en', APP_URL: 'http://localhost' }),
);
// Opening an organization never creates an event, so the events service is not reached.
const concierge = new ConciergeService(database, {} as EventsService, accounts);

const counts = async () => ({
  organizations: await prisma.organization.count(),
  invites: await prisma.organizationInvite.count(),
  messages: await prisma.message.count(),
});

describe('Concierge opening an organization (integration)', () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await prisma.messageTemplate.create({ data: { key: 'organization.invite', channel: 'EMAIL', body: { en: '{{link}}' } } });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(disconnectTestDatabase);

  const staffMember = () =>
    prisma.user.create({ data: { email: 'support@aveline.test', name: 'Support', platformRole: PlatformRole.SUPPORT } });

  it('serializes two simultaneous opens for one email into one organization, invitation and message', async () => {
    const staff = await staffMember();
    const dto = { name: 'Petrosyan Wedding', ownerEmail: 'anna@example.am' };

    const results = await Promise.all([concierge.openForCustomer(staff.id, dto), concierge.openForCustomer(staff.id, dto)]);

    expect(results.map((result) => result.isExisting).sort()).toEqual([false, true]);
    expect(results[0].organization.id).toBe(results[1].organization.id);
    expect(await counts()).toEqual({ organizations: 1, invites: 1, messages: 1 });
  });

  it('leaves no organization or invitation behind when the credential message cannot be written', async () => {
    const staff = await staffMember();
    jest.spyOn(communications, 'enqueueInTransaction').mockRejectedValueOnce(new Error('message store unavailable'));

    await expect(
      concierge.openForCustomer(staff.id, { name: 'Petrosyan Wedding', ownerEmail: 'anna@example.am' }),
    ).rejects.toThrow('message store unavailable');

    expect(await counts()).toEqual({ organizations: 0, invites: 0, messages: 0 });
  });

  it.each([
    ['demoted to a customer', { platformRole: PlatformRole.NONE }],
    ['deactivated', { isActive: false }],
  ])('refuses a staff member %s since signing in, for a customer who already has an organization', async (_label, change) => {
    const staff = await staffMember();
    const anna = await prisma.user.create({ data: { email: 'anna@example.am', name: 'Anna' } });
    const home = await prisma.organization.create({ data: { name: 'Anna Home', kind: 'HOST' } });
    await prisma.organizationMembership.create({ data: { userId: anna.id, organizationId: home.id, role: OrganizationRole.OWNER } });
    // While still active staff, the same open resolves to Anna's organization.
    await expect(
      concierge.openForCustomer(staff.id, { name: 'Petrosyan Wedding', ownerEmail: 'anna@example.am' }),
    ).resolves.toMatchObject({ isExisting: true, organization: { id: home.id } });
    await prisma.user.update({ where: { id: staff.id }, data: change });

    await expect(
      concierge.openForCustomer(staff.id, { name: 'Petrosyan Wedding', ownerEmail: 'anna@example.am' }),
    ).rejects.toMatchObject({ code: 'ORGANIZATION_ACCESS_DENIED' });
  });
});
