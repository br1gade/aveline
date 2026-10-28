import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EventRole, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

describe('Guest corrections and invitation improvements (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  const http = () => request(app.getHttpServer() as Server);
  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue(prisma).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  beforeEach(() => resetTestDatabase());
  afterAll(async () => { await app.close(); await disconnectTestDatabase(); });
  const organizer = async (role: EventRole = 'OWNER') => {
    const event = await seedEvent(prisma);
    return { ...event, ...await authenticateAs(app, prisma, { eventId: event.eventId, role }) };
  };
  const asset = (eventId: string, kind: 'PHOTO' | 'AUDIO' | 'DOCUMENT' = 'PHOTO') => prisma.mediaAsset.create({
    data: { eventId, kind, url: 'https://media.aveline.test/example.png', width: 960, height: 640,
      variants: [{ width: 480, height: 320, url: 'https://media.aveline.test/small.webp' }] },
  });

  describe('personal name correction', () => {
    it('changes only the link holder names while preserving credentials, household and answers', async () => {
      const { slug, primaryGuestToken } = await organizer();
      const before = await prisma.guest.findUniqueOrThrow({ where: { token: primaryGuestToken }, include: { rsvp: true } });
      const { body } = await http().patch(`/api/v1/invitations/${slug}/g/${primaryGuestToken}/name`)
        .send({ firstName: '  Անի  ', lastName: '  Dupont  ' }).expect(200);
      expect(body).toEqual({ id: before.id, firstName: 'Անի', lastName: 'Dupont', name: 'Անի Dupont' });
      const after = await prisma.guest.findUniqueOrThrow({ where: { id: before.id }, include: { rsvp: true } });
      expect(after).toMatchObject({ householdId: before.householdId, token: primaryGuestToken, rsvp: before.rsvp });
      const page = await http().get(`/api/v1/invitations/${slug}/g/${primaryGuestToken}`).expect(200);
      expect(page.body.guest.name).toBe('Անի Dupont');
    });
    it.each([{ firstName: '   ' }, { firstName: null }, { lastName: 'x'.repeat(101) }, { firstName: 'Ani', guestId: 'another' }])(
      'rejects invalid or broader edits: %j', async (edit) => {
        const { slug, primaryGuestToken } = await organizer();
        await http().patch(`/api/v1/invitations/${slug}/g/${primaryGuestToken}/name`).send(edit).expect(400);
      },
    );
    it('allows partial edits and clearing the surname', async () => {
      const { slug, primaryGuestToken } = await organizer();
      const { body } = await http().patch(`/api/v1/invitations/${slug}/g/${primaryGuestToken}/name`)
        .send({ lastName: null }).expect(200);
      expect(body).toMatchObject({ firstName: 'Primary', lastName: null });
    });
    it('rejects another invitation, missing credentials, drafts and expiry', async () => {
      const { slug, primaryGuestToken } = await organizer();
      const other = await seedEvent(prisma);
      const patch = (target: string, token: string) => http().patch(`/api/v1/invitations/${target}/g/${token}/name`).send({ firstName: 'Ani' });
      await patch(other.slug, primaryGuestToken).expect(404);
      await patch(slug, 'invalid-token').expect(404);
      await prisma.invitation.update({ where: { slug }, data: { status: 'DRAFT' } });
      await patch(slug, primaryGuestToken).expect(404);
      await prisma.invitation.update({ where: { slug }, data: { status: 'PUBLISHED', expiresAt: new Date(0) } });
      await patch(slug, primaryGuestToken).expect(404);
    });
  });

  describe('question ordering', () => {
    const questions = async () => {
      const event = await organizer('DESIGNER');
      const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug: event.slug } });
      const ids: string[] = [];
      for (let sortOrder = 0; sortOrder < 3; sortOrder += 1) {
        const question = await prisma.rsvpQuestion.create({ data: { invitationId: invitation.id,
          type: 'SINGLE_CHOICE', prompt: { en: 'Meal?' }, options: { en: ['Meat', 'Fish'] }, required: true, sortOrder } });
        ids.push(question.id);
      }
      return { ...event, ids };
    };
    it('atomically reorders answered questions without changing definitions or answers', async () => {
      const { slug, primaryGuestToken, authorization, ids } = await questions();
      const rsvp = await prisma.rsvp.findFirstOrThrow({ where: { guest: { token: primaryGuestToken } } });
      await prisma.rsvpAnswer.create({ data: { rsvpId: rsvp.id, questionId: ids[0], value: 1 } });
      const { body } = await http().patch(`/api/v1/invitations/${slug}/question-order`).set('Authorization', authorization)
        .send({ questionIds: [...ids].reverse(), expectedOrder: ids }).expect(200);
      expect((body as { id: string }[]).map((q) => q.id)).toEqual([...ids].reverse());
      expect(body[2]).toMatchObject({ required: true, options: { en: ['Meat', 'Fish'] } });
      expect(await prisma.rsvpAnswer.findFirst({ where: { questionId: ids[0] } })).toMatchObject({ value: 1 });
    });
    it('rejects duplicate, incomplete, foreign and stale orders without partial changes', async () => {
      const { slug, authorization, ids } = await questions();
      const reorder = (questionIds: string[]) => http().patch(`/api/v1/invitations/${slug}/question-order`)
        .set('Authorization', authorization).send({ questionIds, expectedOrder: ids });
      await reorder([ids[0], ids[0], ids[2]]).expect(400);
      await reorder(ids.slice(1)).expect(400);
      await reorder([ids[0], ids[1], 'foreign']).expect(400);
      await reorder([...ids].reverse()).expect(200);
      await reorder(ids).expect(409);
    });
    it('allows only one of two conflicting organizer reorders', async () => {
      const { slug, authorization, ids } = await questions();
      const orders = [[...ids].reverse(), [ids[1], ids[0], ids[2]]];
      const results = await Promise.all(orders.map((questionIds) => http().patch(`/api/v1/invitations/${slug}/question-order`)
        .set('Authorization', authorization).send({ questionIds, expectedOrder: ids })));
      expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
    });
  });

  describe('directory operators', () => {
    const staff = async () => {
      const auth = await authenticateAs(app, prisma);
      await prisma.user.update({ where: { id: auth.userId }, data: { platformRole: 'ADMIN' } });
      return auth.authorization;
    };
    it('links several halls independently and exposes a vendor collection', async () => {
      const authorization = await staff();
      const vendor = await prisma.vendor.create({ data: { name: 'Venue operator', category: 'VENUE' } });
      const create = (name: string) => http().post('/api/v1/venue-profiles').set('Authorization', authorization)
        .send({ name, address: 'Yerevan', vendorId: vendor.id }).expect(201);
      const first = await create('Hall one');
      const second = await create('Hall two');
      const { body } = await http().get('/api/v1/vendors').set('Authorization', authorization).expect(200);
      expect(body[0].venueProfiles).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: first.body.id }), expect.objectContaining({ id: second.body.id }),
      ]));
      await http().patch(`/api/v1/venue-profiles/${first.body.id}`).set('Authorization', authorization).send({ vendorId: null }).expect(200);
      expect(await prisma.venueProfile.findUnique({ where: { id: second.body.id as string } })).toMatchObject({ vendorId: vendor.id });
    });
    it.each(['private', 'inactive', 'wrong-category'])('rejects a %s operator', async (kind) => {
      const { eventId } = await organizer();
      const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
      const vendor = await prisma.vendor.create({ data: { name: 'Invalid', category: kind === 'wrong-category' ? 'CATERING' : 'VENUE',
        organizationId: kind === 'private' ? event.organizationId : null, active: kind !== 'inactive' } });
      const authorization = await staff();
      await http().post('/api/v1/venue-profiles').set('Authorization', authorization)
        .send({ name: 'Hall', address: 'Yerevan', vendorId: vendor.id }).expect(400);
    });
    it('keeps shared-directory editing restricted to staff', async () => {
      const { authorization } = await organizer();
      await http().post('/api/v1/venue-profiles').set('Authorization', authorization)
        .send({ name: 'Hall', address: 'Yerevan', vendorId: null }).expect(403);
    });
  });

  describe('upload kinds', () => {
    it.each(['LOGO', 'COVER', 'PHOTO'])('honors image kind %s and permits HERO attachment', async (kind) => {
      const { eventId, slug, authorization } = await organizer('DESIGNER');
      const { body } = await http().post(`/api/v1/events/${eventId}/media`).set('Authorization', authorization)
        .field('kind', kind).attach('file', Buffer.from('png-fixture'), { filename: 'logo.png', contentType: 'image/png' }).expect(201);
      expect(body.kind).toBe(kind);
      await http().patch(`/api/v1/invitations/${slug}/blocks/HERO`).set('Authorization', authorization).send({ assetIds: [body.id] }).expect(200);
      const library = await http().get(`/api/v1/events/${eventId}/media`).set('Authorization', authorization).expect(200);
      expect(library.body[0]).toMatchObject({ kind, usedBy: ['HERO'] });
    });
    it('honors AUDIO and rejects assigning an image kind to audio', async () => {
      const { eventId, authorization } = await organizer('DESIGNER');
      const upload = (kind: string) => http().post(`/api/v1/events/${eventId}/media`).set('Authorization', authorization).field('kind', kind)
        .attach('file', Buffer.from('ID3-fixture'), { filename: 'song.mp3', contentType: 'audio/mpeg' });
      const { body } = await upload('AUDIO').expect(201);
      expect(body.kind).toBe('AUDIO');
      await upload('LOGO').expect(400);
    });

    it.each(['DOCUMENT', 'SIGNATURE', 'AUDIO', 'unknown'])('rejects image kind %s before storing it', async (kind) => {
      const { eventId, authorization } = await organizer('DESIGNER');
      await http().post(`/api/v1/events/${eventId}/media`).set('Authorization', authorization).field('kind', kind)
        .attach('file', Buffer.from('png-fixture'), { filename: 'logo.png', contentType: 'image/png' }).expect(400);
      expect(await prisma.mediaAsset.count({ where: { eventId } })).toBe(0);
    });
  });

  describe('listing images', () => {
    const listing = async () => {
      const event = await organizer();
      await prisma.event.update({ where: { id: event.eventId }, data: { visibility: 'PUBLIC' } });
      const image = await asset(event.eventId);
      const write = (edit: object) => http().put(`/api/v1/events/${event.eventId}/listing`).set('Authorization', event.authorization).send(edit);
      const { body } = await write({ headline: { en: 'Concert' }, heroAssetId: image.id }).expect(200);
      await http().post(`/api/v1/events/${event.eventId}/listing/publish`).set('Authorization', event.authorization).expect(201);
      return { ...event, image, listingSlug: body.slug as string, write };
    };
    it('hydrates hero and share images with fallback and responsive variants', async () => {
      const { image, listingSlug, write, eventId } = await listing();
      const share = await asset(eventId);
      await write({ ogImageId: share.id }).expect(200);
      const { body } = await http().get(`/api/v1/public/events/${listingSlug}`).query({ locale: 'en' }).expect(200);
      expect(body.heroImage).toMatchObject({ id: image.id, width: 960, variants: image.variants });
      expect(body.metadata).toMatchObject({ imageAssetId: share.id, image: { id: share.id, url: share.url } });
      const browse = await http().get('/api/v1/public/events').expect(200);
      expect(browse.body.items[0].heroImage).toMatchObject({ id: image.id });
      await write({ ogImageId: null }).expect(200);
      const fallback = await http().get(`/api/v1/public/events/${listingSlug}`).expect(200);
      expect(fallback.body.metadata.imageAssetId).toBe(image.id);
    });
    it('rejects cross-event, non-image and missing references atomically', async () => {
      const { write, image, eventId } = await listing();
      const other = await seedEvent(prisma);
      const foreign = await asset(other.eventId);
      const audio = await asset(eventId, 'AUDIO');
      for (const id of [foreign.id, audio.id, 'missing']) await write({ heroAssetId: null, ogImageId: id }).expect(400);
      expect(await prisma.eventListing.findUnique({ where: { eventId } })).toMatchObject({ heroAssetId: image.id });
    });
    it('ignores legacy cross-event references even when both events appear in browse', async () => {
      const { eventId, image, listingSlug } = await listing();
      const other = await seedEvent(prisma, { visibility: 'PUBLIC' });
      const foreign = await asset(other.eventId);
      await prisma.eventListing.create({ data: { eventId: other.eventId, slug: 'another-public-event', headline: { en: 'Other' }, heroAssetId: foreign.id, publishedAt: new Date() } });
      await prisma.eventListing.update({ where: { eventId }, data: { heroAssetId: foreign.id, ogImageId: foreign.id } });
      const { body } = await http().get(`/api/v1/public/events/${listingSlug}`).expect(200);
      expect(body.heroImage).toBeNull();
      expect(body.metadata).toMatchObject({ imageAssetId: null, image: null });
      const browse = await http().get('/api/v1/public/events').expect(200);
      expect((browse.body.items as { slug: string; heroImage: unknown }[]).find((item) => item.slug === listingSlug)?.heroImage).toBeNull();
      await prisma.eventListing.update({ where: { eventId }, data: { heroAssetId: image.id, ogImageId: 'removed-image' } });
      const fallback = await http().get(`/api/v1/public/events/${listingSlug}`).expect(200);
      expect(fallback.body.metadata.imageAssetId).toBe(image.id);
    });

    it('requires clearing listing references before removing images', async () => {
      const { image, eventId, write, authorization } = await listing();
      await http().delete(`/api/v1/events/${eventId}/media/${image.id}`).set('Authorization', authorization).expect(409);
      await write({ heroAssetId: null }).expect(200);
      await http().delete(`/api/v1/events/${eventId}/media/${image.id}`).set('Authorization', authorization).expect(200);
    });
    it('protects share-only images and reports their usage in the host library', async () => {
      const { eventId, image, write, authorization } = await listing();
      await write({ heroAssetId: null, ogImageId: image.id }).expect(200);
      const library = await http().get(`/api/v1/events/${eventId}/media`).set('Authorization', authorization).expect(200);
      expect(library.body[0].listingUses).toEqual(['SHARE']);
      await http().delete(`/api/v1/events/${eventId}/media/${image.id}`).set('Authorization', authorization).expect(409);
      await write({ ogImageId: null }).expect(200);
      await http().delete(`/api/v1/events/${eventId}/media/${image.id}`).set('Authorization', authorization).expect(200);
    });

    it('hides metadata when an event becomes private', async () => {
      const { eventId, listingSlug } = await listing();
      await prisma.event.update({ where: { id: eventId }, data: { visibility: 'PRIVATE' } });
      await http().get(`/api/v1/public/events/${listingSlug}`).expect(404);
      const browse = await http().get('/api/v1/public/events').expect(200);
      expect(browse.body.items).toEqual([]);
    });
  });

  describe('template preview payloads', () => {
    it.each(['en', 'ru', 'fr', 'hy'])('previews synthetic content in %s without real event or guest data', async (locale) => {
      const { eventId, authorization } = await organizer('DESIGNER');
      const { body } = await http().get(`/api/v1/events/${eventId}/design-templates/test-template/preview`)
        .set('Authorization', authorization).query({ locale }).expect(200);
      expect(body).toMatchObject({ isPreview: true, previewSource: 'SYNTHETIC', isAcceptingResponses: false, locale, template: 'test-template', guest: null });
      expect(body.blocks).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'HERO' })]));
      expect(JSON.stringify(body)).not.toContain('Fixture');
    });
    it('retains the current theme and omits internal venues/timeline and private media', async () => {
      const { slug, eventId, authorization } = await organizer('DESIGNER');
      await prisma.event.update({ where: { id: eventId }, data: { locales: ['en', 'ru', 'fr', 'hy'] } });
      await prisma.designTemplate.update({ where: { key: 'test-template' }, data: { supportedBlocks: ['HERO', 'RSVP', 'VENUE', 'TIMELINE'] } });
      const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug } });
      await prisma.invitationBlock.createMany({ data: [
        { invitationId: invitation.id, type: 'VENUE', sortOrder: 2 }, { invitationId: invitation.id, type: 'TIMELINE', sortOrder: 3 },
      ] });
      await prisma.timelineEntry.create({ data: { eventId, label: { fr: 'Bienvenue' }, occursAt: new Date(), isInternal: false } });
      await prisma.invitation.update({ where: { slug }, data: { theme: { headingFont: 'Inter' } } });
      const document = await asset(eventId, 'DOCUMENT');
      await prisma.invitationBlock.updateMany({ where: { invitation: { slug }, type: 'HERO' }, data: { assetIds: [document.id] } });
      await prisma.venue.create({ data: { eventId, role: 'PREPARATION', name: 'Private home', address: 'Hidden address' } });
      await prisma.timelineEntry.create({ data: { eventId, label: { en: 'Secret instructions' }, occursAt: new Date(), isInternal: true } });
      const { body, headers } = await http().get(`/api/v1/invitations/${slug}/template-preview`).set('Authorization', authorization)
        .query({ locale: 'fr' }).expect(200);
      expect(body).toMatchObject({ locale: 'fr', theme: { headingFont: 'Inter' }, coverUrl: null });
      expect(body.blocks[0].media).toEqual([]);
      expect((body.blocks as { type: string; data: unknown }[]).find((block) => block.type === 'VENUE')?.data)
        .toEqual([expect.objectContaining({ name: 'Fixture Hall' })]);
      expect((body.blocks as { type: string; data: unknown }[]).find((block) => block.type === 'TIMELINE')?.data)
        .toEqual([expect.objectContaining({ label: 'Bienvenue' })]);
      expect(JSON.stringify(body)).not.toMatch(/Private home|Hidden address|Secret instructions/);
      expect(headers['cache-control']).toBe('private, no-store');
    });

    it('uses event content and target template rules without publishing or mutating', async () => {
      const { slug, primaryGuestToken, authorization } = await organizer('DESIGNER');
      await prisma.invitation.update({ where: { slug }, data: { status: 'DRAFT', theme: { headingFont: 'Inter' } } });
      await prisma.designTemplate.create({ data: { key: 'another', name: 'Another', allowedFonts: ['Noto Serif Armenian'],
        supportedBlocks: ['HERO'], defaultTheme: { headingFont: 'Noto Serif Armenian' } } });
      const before = await prisma.invitation.findUniqueOrThrow({ where: { slug }, include: { blocks: true } });
      const { body } = await http().get(`/api/v1/invitations/${slug}/template-preview`).set('Authorization', authorization)
        .query({ templateKey: 'another', locale: 'en' }).expect(200);
      expect(body).toMatchObject({ isPreview: true, previewSource: 'EVENT', isAcceptingResponses: false,
        template: 'another', theme: { headingFont: 'Noto Serif Armenian' }, event: { title: 'Fixture Wedding' }, guest: null });
      expect((body.blocks as { type: string }[]).map((block) => block.type)).toEqual(['HERO']);
      expect(JSON.stringify(body)).not.toContain(primaryGuestToken);
      expect(JSON.stringify(body)).not.toContain('household');
      expect(await prisma.invitation.findUniqueOrThrow({ where: { slug }, include: { blocks: true } })).toEqual(before);
    });
    it('rejects unauthenticated, other-event and inactive-template requests', async () => {
      const { slug, eventId, authorization } = await organizer('DESIGNER');
      const other = await organizer();
      const path = `/api/v1/invitations/${slug}/template-preview`;
      await http().get(path).expect(401);
      await http().get(path).set('Authorization', other.authorization).expect(403);
      await prisma.designTemplate.update({ where: { key: 'test-template' }, data: { isActive: false } });
      await http().get(`/api/v1/events/${eventId}/design-templates/test-template/preview`).set('Authorization', authorization).expect(404);
    });
  });
});
