import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BlockType, EventRole, PrismaClient, QuestionType } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { authenticateAs } from '../fixtures/auth.fixture';
import { seedEvent } from '../fixtures/event.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * The write side of the invitation.
 *
 * The theme cases matter most: `allowedFonts` and `palettes` were published to
 * clients and never enforced, so any string reached the renderer. These assert
 * the enforcement over HTTP, where the designer UI actually meets it.
 */
describe('Invitation design (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const http = () => request(app.getHttpServer() as Server);

  beforeAll(async () => {
    prisma = testPrisma();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    await app.init();
  });

  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  const designer = async () => {
    const seeded = await seedEvent(prisma);
    const { authorization } = await authenticateAs(app, prisma, {
      eventId: seeded.eventId,
      role: EventRole.DESIGNER,
    });
    // The fixture template ships one font and no palettes; these tests need
    // both to exercise the boundary.
    await prisma.designTemplate.update({
      where: { key: 'test-template' },
      data: {
        allowedFonts: ['Inter', 'Noto Serif Armenian'],
        palettes: [
          { name: 'blush', colors: ['#f5e1e0', '#b76e79'] },
          { name: 'olive', colors: ['#3f4b3b'] },
        ],
      },
    });
    return { ...seeded, authorization };
  };

  describe('templates', () => {
    it('lists what a designer may choose, with its constraints', async () => {
      const { authorization, eventId } = await designer();

      const { body } = await http()
        .get(`/api/v1/events/${eventId}/design-templates`)
        .set('Authorization', authorization)
        .expect(200);

      expect(body[0]).toMatchObject({ key: 'test-template' });
      expect(body[0].allowedFonts).toContain('Inter');
      expect(body[0].supportedBlocks).toEqual([BlockType.HERO, BlockType.RSVP]);
    });

    it('404s an unknown template key', async () => {
      const { slug, authorization } = await designer();

      await http()
        .post(`/api/v1/invitations/${slug}/template`)
        .set('Authorization', authorization)
        .send({ templateKey: 'does-not-exist' })
        .expect(404);
    });

    /**
     * Switching must be reversible. Disabling an unsupported block keeps the
     * host's copy; deleting it would lose work they cannot get back.
     */
    it('disables unsupported blocks rather than deleting them', async () => {
      const { slug, eventId, authorization } = await designer();
      const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug } });
      await prisma.invitationBlock.create({
        data: {
          invitationId: invitation.id,
          type: BlockType.GALLERY,
          content: { hy: { title: 'Նկարներ' } },
        },
      });
      await prisma.designTemplate.create({
        data: {
          key: 'minimal',
          name: 'Minimal',
          allowedFonts: ['Inter'],
          supportedBlocks: [BlockType.HERO],
          defaultTheme: { bodyFont: 'Inter' },
        },
      });

      await http()
        .post(`/api/v1/invitations/${slug}/template`)
        .set('Authorization', authorization)
        .send({ templateKey: 'minimal' })
        .expect(201);

      const gallery = await prisma.invitationBlock.findFirstOrThrow({
        where: { invitationId: invitation.id, type: BlockType.GALLERY },
      });
      expect(gallery.enabled).toBe(false);
      expect(gallery.content).toEqual({ hy: { title: 'Նկարներ' } });
      expect(eventId).toEqual(expect.any(String));
    });
  });

  describe('theme', () => {
    const patchTheme = (slug: string, authorization: string, body: Record<string, unknown>) =>
      http().patch(`/api/v1/invitations/${slug}/theme`).set('Authorization', authorization).send(body);

    it('accepts a font and palette the template declares', async () => {
      const { slug, authorization } = await designer();

      const { body } = await patchTheme(slug, authorization, {
        bodyFont: 'Noto Serif Armenian',
        palette: 'blush',
      }).expect(200);

      expect(body.theme).toMatchObject({ bodyFont: 'Noto Serif Armenian', palette: 'blush' });
    });

    // The hole this closes.
    it('rejects a font the template does not ship', async () => {
      const { slug, authorization } = await designer();

      const { body } = await patchTheme(slug, authorization, { bodyFont: 'Comic Sans' }).expect(400);

      expect(JSON.stringify(body.message)).toContain('Noto Serif Armenian');
    });

    it('rejects a palette the template does not define', async () => {
      const { slug, authorization } = await designer();

      await patchTheme(slug, authorization, { palette: 'neon' }).expect(400);
    });

    it.each(['#fff', 'red', 'rgb(0,0,0)'])('rejects %s as a custom colour', async (color) => {
      const { slug, authorization } = await designer();

      await patchTheme(slug, authorization, { colors: [color] }).expect(400);
    });

    it('changes nothing when it rejects', async () => {
      const { slug, authorization } = await designer();
      await patchTheme(slug, authorization, { palette: 'blush' }).expect(200);

      await patchTheme(slug, authorization, { palette: 'neon' }).expect(400);

      const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug } });
      expect(invitation.theme).toMatchObject({ palette: 'blush' });
    });

    // Omitted means "leave as is": changing a font must not clear the palette.
    it('keeps what a partial update does not mention', async () => {
      const { slug, authorization } = await designer();
      await patchTheme(slug, authorization, { palette: 'blush' }).expect(200);

      const { body } = await patchTheme(slug, authorization, { bodyFont: 'Inter' }).expect(200);

      expect(body.theme).toMatchObject({ palette: 'blush', bodyFont: 'Inter' });
    });

    it('reports every problem at once', async () => {
      const { slug, authorization } = await designer();

      const { body } = await patchTheme(slug, authorization, {
        bodyFont: 'Comic Sans',
        headingFont: 'Papyrus',
        palette: 'neon',
      }).expect(400);

      expect(body.message).toHaveLength(3);
    });
  });

  describe('block content', () => {
    it('edits a block the invitation has', async () => {
      const { slug, authorization } = await designer();

      const { body } = await http()
        .patch(`/api/v1/invitations/${slug}/blocks/HERO`)
        .set('Authorization', authorization)
        .send({ content: { hy: { title: 'Արմեն և Լուսինե' } }, variant: 'split' })
        .expect(200);

      expect(body).toMatchObject({ type: 'HERO', variant: 'split' });
      expect(body.content).toEqual({ hy: { title: 'Արմեն և Լուսինե' } });
    });

    it('says to add a missing block through the arrangement call', async () => {
      const { slug, authorization } = await designer();

      const { body } = await http()
        .patch(`/api/v1/invitations/${slug}/blocks/GALLERY`)
        .set('Authorization', authorization)
        .send({ content: {} })
        .expect(404);

      expect(body.message).toContain('arrangement');
    });

    // An asset from another event would put one couple's photos on another's page.
    it('refuses an asset from a different event', async () => {
      const { slug, authorization } = await designer();
      const other = await seedEvent(prisma);
      const asset = await prisma.mediaAsset.create({
        data: { eventId: other.eventId, kind: 'PHOTO', url: 'https://x/y.jpg' },
      });

      await http()
        .patch(`/api/v1/invitations/${slug}/blocks/HERO`)
        .set('Authorization', authorization)
        .send({ assetIds: [asset.id] })
        .expect(400);
    });
  });

  describe('custom RSVP questions', () => {
    const add = (slug: string, authorization: string, body: Record<string, unknown>) =>
      http().post(`/api/v1/invitations/${slug}/questions`).set('Authorization', authorization).send(body);

    it('adds a question and lists it', async () => {
      const { slug, authorization } = await designer();

      await add(slug, authorization, {
        type: QuestionType.TEXT,
        prompt: { hy: 'Ձեր նախընտրությունը?' },
        required: true,
      }).expect(201);

      const { body } = await http()
        .get(`/api/v1/invitations/${slug}/questions`)
        .set('Authorization', authorization)
        .expect(200);
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ type: 'TEXT', required: true });
    });

    it('rejects a question with no prompt in any language', async () => {
      const { slug, authorization } = await designer();

      await add(slug, authorization, { type: QuestionType.TEXT, prompt: {} }).expect(400);
    });

    // A choice question with no choices cannot be answered.
    it.each([QuestionType.SINGLE_CHOICE, QuestionType.MULTI_CHOICE])(
      'rejects a %s with no options',
      async (type) => {
        const { slug, authorization } = await designer();

        const { body } = await add(slug, authorization, {
          type,
          prompt: { hy: 'Ընտրեք' },
        }).expect(400);

        expect(body.message).toContain('choices');
      },
    );

    it('accepts a choice question with options', async () => {
      const { slug, authorization } = await designer();

      await add(slug, authorization, {
        type: QuestionType.SINGLE_CHOICE,
        prompt: { hy: 'Ընտրեք' },
        options: { hy: ['Միս', 'Ձուկ'] },
      }).expect(201);
    });

    it('removes an unanswered question', async () => {
      const { slug, authorization } = await designer();
      const { body: created } = await add(slug, authorization, {
        type: QuestionType.TEXT,
        prompt: { hy: 'Ձեր նախընտրությունը?' },
      }).expect(201);

      await http()
        .delete(`/api/v1/invitations/${slug}/questions/${created.id}`)
        .set('Authorization', authorization)
        .expect(200);
    });

    /**
     * Deleting an answered question would discard what guests told the host,
     * which is not what "remove this field" means to the person clicking it.
     */
    it('refuses to remove an answered question and says what to do instead', async () => {
      const { slug, authorization, primaryGuestToken } = await designer();
      const { body: created } = await add(slug, authorization, {
        type: QuestionType.TEXT,
        prompt: { hy: 'Ձեր նախընտրությունը?' },
      }).expect(201);
      const guest = await prisma.guest.findFirstOrThrow({ where: { token: primaryGuestToken } });
      const rsvp = await prisma.rsvp.findFirstOrThrow({ where: { guestId: guest.id } });
      await prisma.rsvpAnswer.create({
        data: { rsvpId: rsvp.id, questionId: created.id, value: { text: 'Ձուկ' } },
      });

      const { body } = await http()
        .delete(`/api/v1/invitations/${slug}/questions/${created.id}`)
        .set('Authorization', authorization)
        .expect(400);

      expect(body.message).toContain('optional');
    });
  });

  describe('venues', () => {
    const coordinator = async () => {
      const seeded = await seedEvent(prisma);
      const { authorization } = await authenticateAs(app, prisma, {
        eventId: seeded.eventId,
        role: EventRole.COORDINATOR,
      });
      return { ...seeded, authorization };
    };

    it('adds a venue typed once', async () => {
      const { eventId, authorization } = await coordinator();

      const { body } = await http()
        .post(`/api/v1/events/${eventId}/venues`)
        .set('Authorization', authorization)
        .send({ role: 'RECEPTION', name: 'Tsitsernakaberd Hall', address: 'Yerevan, Armenia' })
        .expect(201);

      expect(body).toMatchObject({ role: 'RECEPTION', name: 'Tsitsernakaberd Hall' });
    });

    it('copies the directory entry’s details rather than referencing them', async () => {
      const { eventId, authorization } = await coordinator();
      const profile = await prisma.venueProfile.create({
        data: {
          name: 'Ararat Hall',
          address: 'Yerevan',
          city: 'Yerevan',
          capacity: 220,
          latitude: 40.1,
          longitude: 44.5,
        },
      });

      const { body } = await http()
        .post(`/api/v1/events/${eventId}/venues`)
        .set('Authorization', authorization)
        .send({ role: 'CEREMONY', name: 'Ararat Hall', address: 'Yerevan', profileId: profile.id })
        .expect(201);

      expect(body).toMatchObject({ capacity: 220, latitude: 40.1 });

      // Changing the directory must not rewrite an invitation already sent.
      await prisma.venueProfile.update({
        where: { id: profile.id },
        data: { address: 'Somewhere else' },
      });
      const venue = await prisma.venue.findUniqueOrThrow({ where: { id: body.id } });
      expect(venue.address).toBe('Yerevan');
    });

    it('rejects a role that is not one', async () => {
      const { eventId, authorization } = await coordinator();

      await http()
        .post(`/api/v1/events/${eventId}/venues`)
        .set('Authorization', authorization)
        .send({ role: 'NIGHTCLUB', name: 'X', address: 'Y' })
        .expect(400);
    });

    it('refuses to remove a venue the timeline still points at', async () => {
      const { eventId, authorization } = await coordinator();
      const { body: venue } = await http()
        .post(`/api/v1/events/${eventId}/venues`)
        .set('Authorization', authorization)
        .send({ role: 'RECEPTION', name: 'Hall', address: 'Yerevan' })
        .expect(201);
      await prisma.timelineEntry.create({
        data: { eventId, venueId: venue.id, label: { hy: 'Ընթրիք' }, occursAt: new Date() },
      });

      await http()
        .delete(`/api/v1/events/${eventId}/venues/${venue.id}`)
        .set('Authorization', authorization)
        .expect(400);
    });

    it('removes a venue nothing depends on', async () => {
      const { eventId, authorization } = await coordinator();
      const { body: venue } = await http()
        .post(`/api/v1/events/${eventId}/venues`)
        .set('Authorization', authorization)
        .send({ role: 'RECEPTION', name: 'Hall', address: 'Yerevan' })
        .expect(201);

      await http()
        .delete(`/api/v1/events/${eventId}/venues/${venue.id}`)
        .set('Authorization', authorization)
        .expect(200);
    });
  });
});
