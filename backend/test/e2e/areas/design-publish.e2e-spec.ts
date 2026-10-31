import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { BlockType, EventRole, EventVisibility, InvitationStatus, PrismaClient, QuestionType } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { PrismaService } from '../../../src/prisma/prisma.service';
import { authenticateAs } from '../../fixtures/auth.fixture';
import { seedEvent } from '../../fixtures/event.fixture';
import { reviseTemplateFixture } from '../../fixtures/template.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

const RSVP_BLOCKER = 'Turn on the RSVP block, or guests will have no way to answer';
const VENUE_BLOCKER = 'Add a venue with an address, so guests know where to go';
const STARTED_BLOCKER = 'This event has already started; an invitation now would arrive late';

/**
 * Designing and publishing an invitation, at the HTTP boundary: what the
 * editor sees as still blocking publication, who may change the page or make
 * it live, and the rules that protect answers guests already gave.
 */
describe('Invitation design and publishing coverage (e2e)', () => {
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

  const draftAs = async (role: EventRole, options: { isPublished?: boolean } = {}) => {
    const seeded = await seedEvent(prisma, { isPublished: options.isPublished ?? false, visibility: EventVisibility.UNLISTED });
    const { authorization } = await authenticateAs(app, prisma, { eventId: seeded.eventId, role });
    return { ...seeded, authorization };
  };

  /**
   * Breaks all three readiness rules at once: RSVP off, no venue with an
   * address, a past start. The venue is emptied rather than deleted because a
   * seating arrangement already hangs off it.
   */
  const breakEveryRule = async (eventId: string, slug: string) => {
    await prisma.invitationBlock.updateMany({ where: { invitation: { slug }, type: BlockType.RSVP }, data: { enabled: false } });
    await prisma.venue.updateMany({ where: { eventId }, data: { address: '' } });
    await prisma.event.update({ where: { id: eventId }, data: { startsAt: new Date(Date.now() - 3_600_000) } });
  };

  const addQuestion = (slug: string, authorization: string, body: Record<string, unknown>) =>
    http().post(`/api/v1/invitations/${slug}/questions`).set('Authorization', authorization).send(body);

  describe('what the editor reports as blocking publication', () => {
    const readDesign = (slug: string, authorization: string) =>
      http().get(`/api/v1/invitations/${slug}/design`).set('Authorization', authorization);

    it('reports nothing for a draft with RSVP on, a venue with an address and a future start', async () => {
      const { slug, authorization } = await draftAs(EventRole.DESIGNER);

      const { body } = await readDesign(slug, authorization).expect(200);

      expect(body.publishBlockers).toEqual([]);
    });

    it('names every blocker at once: RSVP off, no venue and an event already started', async () => {
      const { slug, eventId, authorization } = await draftAs(EventRole.DESIGNER);
      await breakEveryRule(eventId, slug);

      const { body } = await readDesign(slug, authorization).expect(200);

      expect(body.publishBlockers).toEqual([RSVP_BLOCKER, VENUE_BLOCKER, STARTED_BLOCKER]);
    });

    it('reports a venue whose address is blank as no venue', async () => {
      const { slug, eventId, authorization } = await draftAs(EventRole.DESIGNER);
      await prisma.venue.updateMany({ where: { eventId }, data: { address: '   ' } });

      const { body } = await readDesign(slug, authorization).expect(200);

      expect(body.publishBlockers).toEqual([VENUE_BLOCKER]);
    });
  });

  describe('publishing', () => {
    const publish = (slug: string, authorization: string) =>
      http().post(`/api/v1/invitations/${slug}/publish`).set('Authorization', authorization);

    it('refuses an event that has already started, and leaves it a draft', async () => {
      const { slug, eventId, authorization } = await draftAs(EventRole.OWNER);
      await prisma.event.update({ where: { id: eventId }, data: { startsAt: new Date(Date.now() - 60_000) } });

      const { body } = await publish(slug, authorization).expect(400);

      expect(body.message).toEqual([STARTED_BLOCKER]);
      expect(await prisma.invitation.findUniqueOrThrow({ where: { slug } })).toMatchObject({ status: InvitationStatus.DRAFT, firstPublishedAt: null });
    });

    it('names all three blockers in one refusal and publishes nothing', async () => {
      const { slug, eventId, authorization } = await draftAs(EventRole.OWNER);
      await breakEveryRule(eventId, slug);

      const { body } = await publish(slug, authorization).expect(400);

      expect(body.message).toEqual([RSVP_BLOCKER, VENUE_BLOCKER, STARTED_BLOCKER]);
      expect(await prisma.invitation.findUniqueOrThrow({ where: { slug } })).toMatchObject({ status: InvitationStatus.DRAFT });
    });

    it('publishes once the start is moved back into the future', async () => {
      const { slug, eventId, authorization } = await draftAs(EventRole.OWNER);
      await prisma.event.update({ where: { id: eventId }, data: { startsAt: new Date(Date.now() - 60_000) } });
      await publish(slug, authorization).expect(400);
      await prisma.event.update({ where: { id: eventId }, data: { startsAt: new Date(Date.now() + 86_400_000) } });

      const { body } = await publish(slug, authorization).expect(201);

      expect(body.status).toBe(InvitationStatus.PUBLISHED);
      expect(await prisma.invitation.findUniqueOrThrow({ where: { slug } })).toMatchObject({ status: InvitationStatus.PUBLISHED });
    });
  });

  describe('who may make the invitation live', () => {
    const startingStatus: Record<string, InvitationStatus> = {
      publish: InvitationStatus.DRAFT,
      close: InvitationStatus.PUBLISHED,
      reopen: InvitationStatus.CLOSED,
    };
    const resultingStatus: Record<string, InvitationStatus> = {
      publish: InvitationStatus.PUBLISHED,
      close: InvitationStatus.CLOSED,
      reopen: InvitationStatus.PUBLISHED,
    };

    it.each([
      [EventRole.DESIGNER, 'publish'], [EventRole.DESIGNER, 'close'], [EventRole.DESIGNER, 'reopen'],
      [EventRole.VIEWER, 'publish'], [EventRole.VIEWER, 'close'], [EventRole.VIEWER, 'reopen'],
    ])('refuses a %s permission to %s, and the status stays as it was', async (role, action) => {
      const { slug, authorization } = await draftAs(role);
      const status = startingStatus[action];
      await prisma.invitation.update({ where: { slug }, data: { status } });

      const { body } = await http().post(`/api/v1/invitations/${slug}/${action}`).set('Authorization', authorization).expect(403);

      expect(body.message).toBe('This account may not invitation:publish');
      expect(await prisma.invitation.findUniqueOrThrow({ where: { slug } })).toMatchObject({ status });
    });

    // The other side of the boundary: a coordinator holds invitation:publish without owning the event.
    it.each(['publish', 'close', 'reopen'])('lets a coordinator %s the invitation', async (action) => {
      const { slug, authorization } = await draftAs(EventRole.COORDINATOR);
      await prisma.invitation.update({ where: { slug }, data: { status: startingStatus[action] } });

      const { body } = await http().post(`/api/v1/invitations/${slug}/${action}`).set('Authorization', authorization).expect(201);

      expect(body.status).toBe(resultingStatus[action]);
      expect(await prisma.invitation.findUniqueOrThrow({ where: { slug } })).toMatchObject({ status: resultingStatus[action] });
    });
  });

  describe('reopening an expired invitation', () => {
    it('keeps the expired deadline and the captured policy, and the page stays closed to guests', async () => {
      const { slug, authorization } = await draftAs(EventRole.OWNER);
      const base = `/api/v1/invitations/${slug}`;
      await http().post(`${base}/publish`).set('Authorization', authorization).expect(201);
      await http().post(`${base}/close`).set('Authorization', authorization).expect(201);
      await prisma.invitation.update({ where: { slug }, data: { expiresAt: new Date(0) } });

      const { body } = await http().post(`${base}/reopen`).set('Authorization', authorization).expect(201);

      expect(body).toMatchObject({ status: 'PUBLISHED', expiresAt: new Date(0).toISOString(), lifetimeSource: 'FREE_DEFAULT', isExpired: true });
      expect(await prisma.invitation.findUniqueOrThrow({ where: { slug } })).toMatchObject({ expiresAt: new Date(0) });
      await http().get(base).expect(404);
    });
  });

  describe('switching template', () => {
    it('resets a custom theme to the new template’s default theme', async () => {
      const { slug, authorization } = await draftAs(EventRole.DESIGNER);
      await reviseTemplateFixture(prisma, {
        where: { key: 'test-template' },
        data: { allowedFonts: ['Inter'], palettes: [{ name: 'blush', colors: ['#f5e1e0'] }] },
      });
      const { body: themed } = await http().patch(`/api/v1/invitations/${slug}/theme`).set('Authorization', authorization).send({ palette: 'blush' }).expect(200);
      expect(themed.theme).toMatchObject({ palette: 'blush' });
      await prisma.designTemplate.create({
        data: { key: 'minimal', name: 'Minimal', allowedFonts: ['Inter'], supportedBlocks: [BlockType.HERO, BlockType.RSVP], defaultTheme: { bodyFont: 'Inter' } },
      });

      const { body } = await http().post(`/api/v1/invitations/${slug}/template`).set('Authorization', authorization).send({ templateKey: 'minimal' }).expect(201);

      expect(body.theme).toEqual({ bodyFont: 'Inter' });
      expect((await prisma.invitation.findUniqueOrThrow({ where: { slug } })).theme).toEqual({ bodyFont: 'Inter' });
    });
  });

  describe('who may change the design', () => {
    const viewerWithQuestion = async () => {
      const owner = await draftAs(EventRole.OWNER);
      const { body: question } = await addQuestion(owner.slug, owner.authorization, {
        type: QuestionType.SINGLE_CHOICE, prompt: { en: 'Meal?' }, options: { en: ['Meat', 'Fish'] },
      }).expect(201);
      const { authorization } = await authenticateAs(app, prisma, { eventId: owner.eventId, role: EventRole.VIEWER });
      return { slug: owner.slug, questionId: question.id as string, authorization };
    };

    const snapshot = async (slug: string) => {
      const invitation = await prisma.invitation.findUniqueOrThrow({
        where: { slug },
        select: {
          theme: true, templateId: true,
          blocks: { orderBy: { type: 'asc' }, select: { type: true, enabled: true, variant: true, sortOrder: true, content: true } },
          questions: { orderBy: { id: 'asc' }, select: { id: true, type: true, required: true, prompt: true, options: true, sortOrder: true } },
        },
      });
      return invitation;
    };

    type Attempt = (slug: string, questionId: string) => request.Test;
    const attempts: [string, Attempt][] = [
      ['POST template', (slug) => http().post(`/api/v1/invitations/${slug}/template`).send({ templateKey: 'test-template' })],
      ['PATCH theme', (slug) => http().patch(`/api/v1/invitations/${slug}/theme`).send({ bodyFont: 'Inter' })],
      ['PATCH blocks/HERO', (slug) => http().patch(`/api/v1/invitations/${slug}/blocks/HERO`).send({ content: { en: { title: 'Changed' } } })],
      ['PATCH arrangement', (slug) => http().patch(`/api/v1/invitations/${slug}/arrangement`).send({ blocks: [{ type: 'RSVP' }, { type: 'HERO' }] })],
      ['POST questions', (slug) => http().post(`/api/v1/invitations/${slug}/questions`).send({ type: QuestionType.TEXT, prompt: { en: 'New?' } })],
      ['PATCH questions/:id', (slug, id) => http().patch(`/api/v1/invitations/${slug}/questions/${id}`).send({ prompt: { en: 'Changed?' } })],
      ['DELETE questions/:id', (slug, id) => http().delete(`/api/v1/invitations/${slug}/questions/${id}`)],
      ['PATCH question-order', (slug, id) => http().patch(`/api/v1/invitations/${slug}/question-order`).send({ questionIds: [id], expectedOrder: [id] })],
    ];

    it.each(attempts)('refuses a viewer %s with 403 and changes nothing', async (_route, attempt) => {
      const { slug, questionId, authorization } = await viewerWithQuestion();
      const before = await snapshot(slug);

      const { body } = await attempt(slug, questionId).set('Authorization', authorization).expect(403);

      expect(body.message).toBe('This account may not invitation:design');
      expect(await snapshot(slug)).toEqual(before);
    });
  });

  describe('a question on another invitation', () => {
    const otherEventQuestion = async () => {
      const mine = await draftAs(EventRole.DESIGNER);
      const theirs = await draftAs(EventRole.DESIGNER);
      const { body: question } = await addQuestion(theirs.slug, theirs.authorization, {
        type: QuestionType.TEXT, prompt: { en: 'Their question?' }, required: true,
      }).expect(201);
      return { mine, questionId: question.id as string };
    };

    it('cannot be changed through this invitation', async () => {
      const { mine, questionId } = await otherEventQuestion();

      const { body } = await http()
        .patch(`/api/v1/invitations/${mine.slug}/questions/${questionId}`)
        .set('Authorization', mine.authorization)
        .send({ prompt: { en: 'Hijacked?' }, required: false })
        .expect(404);

      expect(body.message).toMatch(/No such question/);
      expect(await prisma.rsvpQuestion.findUniqueOrThrow({ where: { id: questionId } })).toMatchObject({ prompt: { en: 'Their question?' }, required: true });
    });

    it('cannot be removed through this invitation', async () => {
      const { mine, questionId } = await otherEventQuestion();

      const { body } = await http().delete(`/api/v1/invitations/${mine.slug}/questions/${questionId}`).set('Authorization', mine.authorization).expect(404);

      expect(body.message).toMatch(/No such question/);

      expect(await prisma.rsvpQuestion.count({ where: { id: questionId } })).toBe(1);
    });

    it.each(['PATCH', 'DELETE'])('404s an unknown question id on %s', async (method) => {
      const { slug, authorization } = await draftAs(EventRole.DESIGNER);
      const path = `/api/v1/invitations/${slug}/questions/00000000-0000-4000-8000-000000000000`;
      const call = method === 'PATCH' ? http().patch(path).send({ required: true }) : http().delete(path);

      const { body } = await call.set('Authorization', authorization).expect(404);

      expect(body.message).toMatch(/No such question/);
    });
  });

  // Answers are stored by position, so moving an option relabels every answer
  // that picked it (docs/API.md "Custom RSVP questions").
  describe('an answered choice question', () => {
    it('refuses reordering its options, and keeps the stored order', async () => {
      const { slug, eventId, authorization } = await draftAs(EventRole.DESIGNER);
      const { body: question } = await addQuestion(slug, authorization, {
        type: QuestionType.SINGLE_CHOICE, prompt: { en: 'Meal?' }, options: { en: ['Meat', 'Fish', 'Vegan'] },
      }).expect(201);
      const guest = await prisma.guest.findFirstOrThrow({ where: { eventId } });
      const rsvp = await prisma.rsvp.upsert({ where: { guestId: guest.id }, create: { guestId: guest.id, status: 'ATTENDING' }, update: { status: 'ATTENDING' } });
      await prisma.rsvpAnswer.create({ data: { rsvpId: rsvp.id, questionId: question.id as string, value: 1 } });

      const { body } = await http()
        .patch(`/api/v1/invitations/${slug}/questions/${question.id as string}`)
        .set('Authorization', authorization)
        .send({ options: { en: ['Fish', 'Meat', 'Vegan'] } })
        .expect(400);

      expect(body.message).toMatch(/^options:.*1 guest/);
      expect(await prisma.rsvpQuestion.findUniqueOrThrow({ where: { id: question.id as string } })).toMatchObject({ options: { en: ['Meat', 'Fish', 'Vegan'] } });
    });
  });
});
