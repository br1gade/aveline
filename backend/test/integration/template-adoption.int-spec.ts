import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TemplateAdoptionService } from '../../src/modules/design/templates/template-adoption.service';
import { TemplateGatesService } from '../../src/modules/design/templates/template-gates.service';
import { CacheService } from '../../src/infra/cache/cache.service';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';
describe('explicit template preview and adoption', () => {
  let prisma: PrismaClient; let service: TemplateAdoptionService;
  beforeAll(() => { prisma = testPrisma(); service = new TemplateAdoptionService(prisma as unknown as PrismaService, { invalidateInvitation: jest.fn() } as unknown as CacheService, new TemplateGatesService(new ConfigService({ TEMPLATE_ADOPTION_ENABLED: 'true' }))); });
  beforeEach(() => resetTestDatabase()); afterAll(() => disconnectTestDatabase());
  const setup = async () => {
    const event = await seedEvent(prisma);
    const user = await prisma.user.create({ data: { name: 'Designer', email: `${randomUUID()}@test.local`, eventMemberships: { create: { eventId: event.eventId, role: 'DESIGNER' } } } });
    const template = await prisma.designTemplate.create({ data: { key: randomUUID(), name: 'Target', supportedBlocks: ['HERO'], defaultTheme: { new: 'theme' } } });
    const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug: event.slug } });
    return { ...event, user, template, invitation, expectedDesignRevision: String(invitation.designRevision), targetVersionId: template.id + ':baseline' };
  };
  it('requires the exact source revision and applies the immutable pin without changing lifetime or attendance', async () => {
    const state = await setup();
    const preview = await service.preview(state.user.id, state.slug, state);
    const intent = { targetVersionId: state.targetVersionId, expectedDesignRevision: state.expectedDesignRevision, templateKey: state.template.key, expectedTemplateVersionId: state.invitation.templateVersionId, previewId: preview.previewId, idempotencyKey: randomUUID() };
    const first = await service.apply(state.user.id, state.slug, intent);
    expect(await service.apply(state.user.id, state.slug, intent)).toEqual(first);
    await prisma.designTemplate.update({ where: { id: state.template.id }, data: { isActive: false, retiredAt: new Date() } });
    expect(await service.apply(state.user.id, state.slug, intent)).toEqual(first);
    const after = await prisma.invitation.findUniqueOrThrow({ where: { slug: state.slug }, include: { blocks: true } });
    expect(after.templateVersionId).toBe(state.targetVersionId);
    expect(after.blocks.find((block) => block.type === 'RSVP')?.enabled).toBe(false);
    expect(after.expiresAt).toEqual(state.invitation.expiresAt);
    expect(after.firstPublishedAt).toEqual(state.invitation.firstPublishedAt);
    expect(after.status).toBe(state.invitation.status);
    expect((await prisma.event.findUniqueOrThrow({ where: { id: state.eventId } })).attendanceRevision).toBe(1);
  });
  it('rejects a preview after a concurrent raw block edit or authority revocation', async () => {
    const state = await setup(); const preview = await service.preview(state.user.id, state.slug, state);
    await prisma.invitationBlock.updateMany({ where: { invitationId: state.invitation.id }, data: { variant: 'changed' } });
    const intent = { targetVersionId: state.targetVersionId, expectedDesignRevision: state.expectedDesignRevision, templateKey: state.template.key, expectedTemplateVersionId: state.invitation.templateVersionId, previewId: preview.previewId, idempotencyKey: randomUUID() };
    await expect(service.apply(state.user.id, state.slug, intent)).rejects.toMatchObject({ status: 409 });
    await prisma.eventMembership.deleteMany({ where: { userId: state.user.id } });
    await expect(service.preview(state.user.id, state.slug, state)).rejects.toMatchObject({ status: 403 });
  });
});
