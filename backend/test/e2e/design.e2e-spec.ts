import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BlockType, EventRole, PrismaClient, QuestionType, EventVisibility } from '@prisma/client';
import request from 'supertest';
import sharp from 'sharp';
import { AppModule } from '../../src/app.module';
import { ImageVariantsService } from '../../src/modules/media/image-variants.service';
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
    const seeded = await seedEvent(prisma, { visibility: EventVisibility.UNLISTED });
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
      expect(body[0].blockVariants).toEqual({ HERO: ['full-bleed', 'split'], RSVP: ['split', 'stacked'] });
    });

    // B46: the block edit could switch on a block the template cannot render,
    // and any text was accepted as a layout.
    describe('what a block may be', () => {
      const editBlock = (slug: string, authorization: string, type: string, body: Record<string, unknown>) =>
        http().patch(`/api/v1/invitations/${slug}/blocks/${type}`).set('Authorization', authorization).send(body);

      it('will not switch on a block the template cannot render', async () => {
        const { slug, authorization } = await designer();
        const invitation = await prisma.invitation.findUniqueOrThrow({ where: { slug } });
        await prisma.invitationBlock.create({ data: { invitationId: invitation.id, type: BlockType.GALLERY, enabled: false } });

        const { body } = await editBlock(slug, authorization, 'GALLERY', { enabled: true }).expect(400);

        expect(body.message).toMatch(/^enabled:.*GALLERY/);
      });

      it.each(['carousel', 'stacked'])('refuses a HERO layout the template does not offer: %s', async (variant) => {
        const { slug, authorization } = await designer();

        const { body } = await editBlock(slug, authorization, 'HERO', { variant }).expect(400);

        expect(body.message).toMatch(/^variant:/);
      });

      it('refuses an unoffered layout in an arrangement, and changes nothing', async () => {
        const { slug, authorization } = await designer();

        const { body } = await http()
          .patch(`/api/v1/invitations/${slug}/arrangement`)
          .set('Authorization', authorization)
          .send({ blocks: [{ type: 'RSVP' }, { type: 'HERO', variant: 'carousel' }] })
          .expect(400);

        expect(body.message).toMatch(/HERO.*carousel/);
        const hero = await prisma.invitationBlock.findFirstOrThrow({ where: { invitation: { slug }, type: BlockType.HERO } });
        expect(hero.sortOrder).toBe(0);
      });

      it('clears a layout the new template does not offer when switching', async () => {
        const { slug, authorization } = await designer();
        await editBlock(slug, authorization, 'HERO', { variant: 'split' }).expect(200);
        await prisma.designTemplate.create({
          data: { key: 'plain', name: 'Plain', allowedFonts: ['Inter'], supportedBlocks: [BlockType.HERO, BlockType.RSVP], blockVariants: { HERO: ['full-bleed'] } },
        });

        await http().post(`/api/v1/invitations/${slug}/template`).set('Authorization', authorization).send({ templateKey: 'plain' }).expect(201);

        const hero = await prisma.invitationBlock.findFirstOrThrow({ where: { invitation: { slug }, type: BlockType.HERO } });
        expect(hero.variant).toBeNull();
      });
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
      // The fixture's English copy is untouched by an Armenian edit.
      expect(body.content).toEqual({ hy: { title: 'Արմեն և Լուսինե' }, en: { title: 'Hello' } });
    });

    /**
     * Editing one language used to replace the whole content map, so a host
     * who corrected the English wording deleted the Armenian invitation.
     */
    it('edits one language without touching the others, and removes one sent as null', async () => {
      const { slug, authorization } = await designer();
      const edit = (content: Record<string, unknown>) =>
        http()
          .patch(`/api/v1/invitations/${slug}/blocks/HERO`)
          .set('Authorization', authorization)
          .send({ content })
          .expect(200);

      await edit({ en: { title: 'Anna & Davit' } });
      const armenianPage = await http().get(`/api/v1/invitations/${slug}`).query({ locale: 'hy' }).expect(200);
      const hero = (armenianPage.body.blocks as { type: string; content: unknown }[]).find((b) => b.type === 'HERO');
      expect(hero?.content).toEqual({ title: 'Բարև' });

      const { body } = await edit({ en: null });
      expect(body.content).toEqual({ hy: { title: 'Բարև' } });
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

  /**
   * Photos and music are what make an invitation feel like one. They used to
   * be stored and attached and then never sent to the guest's page — a host
   * would upload a cover photo, see it accepted, and guests would see none.
   * Walked over HTTP from upload to the public page.
   */
  describe('photos and music on the guest page', () => {
    const pixel = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    /** A designer whose template can render music, with an event to upload into. */
    const designerWithMusic = async () => {
      const seeded = await designer();
      // Templates are platform data; the fixture's renders only HERO and RSVP.
      await prisma.designTemplate.update({
        where: { key: 'test-template' },
        data: { supportedBlocks: [BlockType.HERO, BlockType.RSVP, BlockType.MUSIC, BlockType.GALLERY] },
      });
      return seeded;
    };

    const upload = async (eventId: string, authorization: string, kind: 'image' | 'audio') => {
      const file =
        kind === 'image'
          ? { buffer: pixel, filename: 'cover.png', contentType: 'image/png' }
          : { buffer: Buffer.from('ID3fake-mp3'), filename: 'song.mp3', contentType: 'audio/mpeg' };
      const { body } = await http()
        .post(`/api/v1/events/${eventId}/media`)
        .set('Authorization', authorization)
        .attach('file', file.buffer, { filename: file.filename, contentType: file.contentType })
        .expect(201);
      return body as { id: string; url: string; kind: string };
    };

    const attach = (slug: string, authorization: string, type: BlockType, assetIds: string[]) =>
      http()
        .patch(`/api/v1/invitations/${slug}/blocks/${type}`)
        .set('Authorization', authorization)
        .send({ assetIds });

    const arrange = (slug: string, authorization: string, blocks: Record<string, unknown>[]) =>
      http()
        .patch(`/api/v1/invitations/${slug}/arrangement`)
        .set('Authorization', authorization)
        .send({ blocks })
        .expect(200);

    const guestPage = async (slug: string) =>
      (await http().get(`/api/v1/invitations/${slug}`).expect(200)).body as {
        coverUrl: string | null;
        musicUrl: string | null;
        blocks: { type: string; variant: string | null; media: { id: string; url: string; kind: string }[] }[];
      };

    it('shows the hero photo as the cover, and in the hero block, in order', async () => {
      const { slug, eventId, authorization } = await designerWithMusic();
      // Read once first, so a cached page has to be invalidated by the attach.
      expect((await guestPage(slug)).coverUrl).toBeNull();
      const first = await upload(eventId, authorization, 'image');
      const second = await upload(eventId, authorization, 'image');

      await attach(slug, authorization, BlockType.HERO, [second.id, first.id]).expect(200);

      const page = await guestPage(slug);
      expect(page.coverUrl).toBe(second.url);
      const hero = page.blocks.find((block) => block.type === 'HERO');
      expect(hero?.media).toEqual([
        { id: second.id, url: second.url, kind: 'PHOTO', altText: null, width: null, height: null, variants: [] },
        { id: first.id, url: first.url, kind: 'PHOTO', altText: null, width: null, height: null, variants: [] },
      ]);
    });

    // A guest's phone used to download every photo as uploaded.
    it('serves smaller copies of a photo once the resizing job has run', async () => {
      const { slug, eventId, authorization } = await designerWithMusic();
      const large = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#f5e1e0' } })
        .jpeg()
        .toBuffer();
      const { body: upload } = await http()
        .post(`/api/v1/events/${eventId}/media`)
        .set('Authorization', authorization)
        .attach('file', large, { filename: 'couple.jpg', contentType: 'image/jpeg' })
        .expect(201);
      await attach(slug, authorization, BlockType.HERO, [upload.id as string]).expect(200);

      await app.get(ImageVariantsService).processPending();

      const page = await http().get(`/api/v1/invitations/${slug}`).expect(200);
      const hero = (page.body.blocks as { type: string; media: Record<string, unknown>[] }[]).find((b) => b.type === 'HERO');
      expect(hero?.media[0]).toMatchObject({ width: 2400, height: 1600 });
      expect((hero?.media[0].variants as { width: number }[]).map((variant) => variant.width)).toEqual([480, 960, 1600]);
    });

    it('plays the music block’s audio, and stops when the host switches it off', async () => {
      const { slug, eventId, authorization } = await designerWithMusic();
      await arrange(slug, authorization, [{ type: 'HERO' }, { type: 'MUSIC' }, { type: 'RSVP' }]);
      const song = await upload(eventId, authorization, 'audio');
      await attach(slug, authorization, BlockType.MUSIC, [song.id]).expect(200);

      expect((await guestPage(slug)).musicUrl).toBe(song.url);

      await arrange(slug, authorization, [{ type: 'HERO' }, { type: 'MUSIC', enabled: false }, { type: 'RSVP' }]);
      expect((await guestPage(slug)).musicUrl).toBeNull();
    });

    it('sends each block’s chosen layout to the page', async () => {
      const { slug, authorization } = await designerWithMusic();

      await arrange(slug, authorization, [{ type: 'HERO', variant: 'full-bleed' }, { type: 'RSVP' }]);

      const hero = (await guestPage(slug)).blocks.find((block) => block.type === 'HERO');
      expect(hero?.variant).toBe('full-bleed');
    });

    it.each([
      { type: BlockType.MUSIC, kind: 'image' as const },
      { type: BlockType.HERO, kind: 'audio' as const },
      { type: BlockType.GALLERY, kind: 'audio' as const },
    ])('refuses $kind on a $type block with a 400 naming assetIds', async ({ type, kind }) => {
      const { slug, eventId, authorization } = await designerWithMusic();
      await arrange(slug, authorization, [{ type: 'HERO' }, { type: 'MUSIC' }, { type: 'GALLERY' }, { type: 'RSVP' }]);
      const asset = await upload(eventId, authorization, kind);

      const { body } = await attach(slug, authorization, type, [asset.id]).expect(400);

      expect(JSON.stringify(body.message)).toContain('assetIds');
    });
  });

  /**
   * The editor has to load what the host wrote. The only reads of block
   * content were the public pages, which 404 on a draft and return one
   * language and only the enabled blocks — so reopening the editor lost every
   * other language, every switched-off block and every setting.
   */
  describe('reading the invitation back to edit it', () => {
    const readDesign = (slug: string, authorization: string) =>
      http().get(`/api/v1/invitations/${slug}/design`).set('Authorization', authorization);

    const draftDesigner = async () => {
      const seeded = await seedEvent(prisma, { isPublished: false });
      const { authorization } = await authenticateAs(app, prisma, {
        eventId: seeded.eventId,
        role: EventRole.DESIGNER,
      });
      return { ...seeded, authorization };
    };

    it('returns a draft, every language, and blocks that are switched off', async () => {
      const { slug, authorization } = await draftDesigner();
      await http()
        .patch(`/api/v1/invitations/${slug}/arrangement`)
        .set('Authorization', authorization)
        .send({ blocks: [{ type: 'HERO', variant: 'split' }, { type: 'RSVP', enabled: false }] })
        .expect(200);
      await http()
        .patch(`/api/v1/invitations/${slug}/blocks/HERO`)
        .set('Authorization', authorization)
        .send({ settings: { overlay: 0.4 } })
        .expect(200);

      const { body } = await readDesign(slug, authorization).expect(200);

      expect(body).toMatchObject({
        slug,
        status: 'DRAFT',
        event: { locales: ['hy', 'en'], defaultLocale: 'hy' },
        template: { key: 'test-template', supportedBlocks: ['HERO', 'RSVP'] },
      });
      expect(body.blocks).toEqual([
        expect.objectContaining({
          type: 'HERO',
          enabled: true,
          variant: 'split',
          settings: { overlay: 0.4 },
          content: { hy: { title: 'Բարև' }, en: { title: 'Hello' } },
          media: [],
        }),
        expect.objectContaining({ type: 'RSVP', enabled: false }),
      ]);
      // A switched-off RSVP block is the first thing between the host and publishing.
      expect(body.publishBlockers).toEqual(expect.arrayContaining([expect.stringMatching(/RSVP/)]));
    });

    it('returns questions in every language, with how many guests have answered', async () => {
      const { slug, authorization } = await draftDesigner();
      await http()
        .post(`/api/v1/invitations/${slug}/questions`)
        .set('Authorization', authorization)
        .send({ type: 'SINGLE_CHOICE', prompt: { hy: 'Միս թե ձուկ', en: 'Meat or fish' }, options: { hy: ['Միս', 'Ձուկ'], en: ['Meat', 'Fish'] } })
        .expect(201);

      const { body } = await readDesign(slug, authorization).expect(200);

      expect(body.questions).toEqual([
        expect.objectContaining({
          type: 'SINGLE_CHOICE',
          prompt: { hy: 'Միս թե ձուկ', en: 'Meat or fish' },
          options: { hy: ['Միս', 'Ձուկ'], en: ['Meat', 'Fish'] },
          answerCount: 0,
        }),
      ]);
    });

    it('is not readable without an account', async () => {
      const { slug } = await draftDesigner();

      await http().get(`/api/v1/invitations/${slug}/design`).expect(401);
    });

    it('is not readable by an account on another event', async () => {
      const { slug } = await draftDesigner();
      const other = await draftDesigner();

      await readDesign(slug, other.authorization).expect(403);
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

    // B25: a PATCH that left `required` out reset it to false, and one that
    // left `options` out emptied a choice question.
    describe('changing a question', () => {
      const change = (slug: string, authorization: string, questionId: string, body: Record<string, unknown>) =>
        http().patch(`/api/v1/invitations/${slug}/questions/${questionId}`).set('Authorization', authorization).send(body);

      const choice = {
        type: QuestionType.SINGLE_CHOICE,
        prompt: { en: 'Meat or fish?' },
        options: { en: ['Meat', 'Fish'] },
        required: true,
      };

      it('changes only what is sent', async () => {
        const { slug, authorization } = await designer();
        const { body: created } = await add(slug, authorization, choice).expect(201);

        const { body } = await change(slug, authorization, created.id as string, { prompt: { en: 'Main course?' } }).expect(200);

        expect(body).toMatchObject({ ...choice, prompt: { en: 'Main course?' } });
      });

      it('makes a question optional without restating it', async () => {
        const { slug, authorization } = await designer();
        const { body: created } = await add(slug, authorization, choice).expect(201);

        const { body } = await change(slug, authorization, created.id as string, { required: false }).expect(200);

        expect(body).toMatchObject({ ...choice, required: false });
      });

      it('still refuses a change that leaves a choice question with no choices', async () => {
        const { slug, authorization } = await designer();
        const { body: created } = await add(slug, authorization, choice).expect(201);

        const { body } = await change(slug, authorization, created.id as string, { options: { en: [] } }).expect(400);

        expect(body.message).toMatch(/^options:/);
      });
    });

    // B69: a required SIGNATURE question could be created, and then nobody
    // attending could answer; choice lists could differ per language.
    it('refuses a signature question until signatures can be captured', async () => {
      const { slug, authorization } = await designer();

      const { body } = await add(slug, authorization, { type: QuestionType.SIGNATURE, prompt: { en: 'Sign here' }, required: true }).expect(400);

      expect(body.message).toMatch(/^type:/);
    });

    it('refuses choices that differ in number between languages', async () => {
      const { slug, authorization } = await designer();

      const { body } = await add(slug, authorization, {
        type: QuestionType.SINGLE_CHOICE,
        prompt: { en: 'Meal?', hy: 'Ճաշ?' },
        options: { en: ['Meat', 'Fish', 'Vegan'], hy: ['Միս', 'Ձուկ'] },
      }).expect(400);

      expect(body.message).toMatch(/^options:/);
    });

    // B67 (decided 10 October 2026, D10): once answered, reword and add only.
    describe('a question guests have answered', () => {
      const answered = async () => {
        const { slug, authorization, eventId } = await designer();
        const { body: question } = await add(slug, authorization, {
          type: QuestionType.SINGLE_CHOICE,
          prompt: { en: 'Meal?' },
          options: { en: ['Meat', 'Fish', 'Vegan'] },
        }).expect(201);
        const guest = await prisma.guest.findFirstOrThrow({ where: { eventId } });
        const rsvp = await prisma.rsvp.upsert({ where: { guestId: guest.id }, create: { guestId: guest.id, status: 'ATTENDING' }, update: { status: 'ATTENDING' } });
        await prisma.rsvpAnswer.create({ data: { rsvpId: rsvp.id, questionId: question.id as string, value: 1 } });
        const change = (body: Record<string, unknown>) =>
          http().patch(`/api/v1/invitations/${slug}/questions/${question.id as string}`).set('Authorization', authorization).send(body);
        return { change };
      };

      it('lets the host reword options and add one at the end', async () => {
        const { change } = await answered();

        await change({ options: { en: ['Beef', 'Fish', 'Vegan', 'Kids menu'] } }).expect(200);
      });

      it('refuses removing an option, saying how many have answered', async () => {
        const { change } = await answered();

        const { body } = await change({ options: { en: ['Fish', 'Vegan'] } }).expect(400);

        expect(body.message).toMatch(/^options:.*1 guest/);
      });

      it('refuses changing the question\'s type', async () => {
        const { change } = await answered();

        const { body } = await change({ type: QuestionType.TEXT }).expect(400);

        expect(body.message).toMatch(/^type:/);
      });
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
      const seeded = await seedEvent(prisma, { visibility: EventVisibility.UNLISTED });
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
