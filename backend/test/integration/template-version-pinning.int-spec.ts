import { Prisma, PrismaClient } from '@prisma/client';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';
import { invitationInclude } from '../../src/modules/invitations/invitations.service';
import { buildInvitationContent } from '../../src/modules/invitations/invitation-content';
import { pinnedTemplate } from '../../src/modules/design/templates/template-content';

describe('immutable template pins', () => {
  let prisma: PrismaClient;
  beforeAll(() => { prisma = testPrisma(); });
  beforeEach(() => resetTestDatabase());
  afterAll(() => disconnectTestDatabase());
  it('pins compatibility inserts and keeps serialized rendering fixed after activation', async () => {
    const event = await seedEvent(prisma);
    const before = await prisma.invitation.findUniqueOrThrow({ where: { slug: event.slug }, include: { ...invitationInclude, templateVersion: true } });
    const payload = () => buildInvitationContent({ ...before, template: pinnedTemplate(before), media: new Map() });
    const original = JSON.stringify(payload());
    const { id: _id, ...baseline } = before.templateVersion;
    const next = await prisma.designTemplateVersion.create({ data: { ...baseline, palettes: baseline.palettes as Prisma.InputJsonValue, blockVariants: baseline.blockVariants as Prisma.InputJsonValue, assetManifest: baseline.assetManifest as Prisma.InputJsonValue, versionNumber: 2, defaultTheme: { different: true }, contentHash: 'v2' } });
    await prisma.designTemplate.update({ where: { id: before.templateId }, data: { activeVersionId: next.id } });
    const after = await prisma.invitation.findUniqueOrThrow({ where: { slug: event.slug }, include: { ...invitationInclude, templateVersion: true } });
    expect(after.templateVersionId).toBe(before.templateVersionId);
    expect(JSON.stringify(buildInvitationContent({ ...after, template: pinnedTemplate(after), media: new Map() }))).toBe(original);
    expect(after.expiresAt).toEqual(before.expiresAt);
    expect(after.firstPublishedAt).toEqual(before.firstPublishedAt);
  });
  it('rejects raw mutation and tenant-mismatched pins', async () => {
    const event = await seedEvent(prisma);
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug: event.slug } });
    await expect(prisma.$executeRaw`UPDATE design_template_versions SET name='changed' WHERE id=${invitation.templateVersionId}`).rejects.toThrow('immutable');
    await expect(prisma.$executeRaw`UPDATE invitations SET "organizationId"='foreign' WHERE id=${invitation.id}`).rejects.toThrow('organization mismatch');
  });
});
