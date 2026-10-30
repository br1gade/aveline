import type { Server } from 'node:http';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MessageChannel, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../setup/test-database';

/**
 * Account lifecycle: recovering a password, proving an address, joining an
 * organization. Each hands out a token, so each is a way in — the tests below
 * are mostly about the ways that must not work.
 */
describe('Account lifecycle (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const http = () => request(app.getHttpServer() as Server);
  const owner = { email: 'owner@test.local', password: 'a-long-enough-password', name: 'Owner' };

  /** Outside production the API returns the link it would have emailed,
   *  which is how a developer completes these flows with no transport. */
  const tokenFrom = (body: unknown) => {
    const { devLink: link } = body as { devLink?: string };
    if (!link) throw new Error('expected a devLink outside production');
    return new URL(link).searchParams.get('token') ?? '';
  };

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

  const register = async (credentials = owner) => {
    await http().post('/api/v1/auth/register').send(credentials).expect(202);
    const { body } = await http()
      .post('/api/v1/auth/login')
      .send({ email: credentials.email, password: credentials.password })
      .expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });
    return { tokens: body as { accessToken: string }, user };
  };

  describe('registering an address that already has an account (D16)', () => {
    /** The notice is sent after the answer, so the test waits for it to land. */
    const noticesTo = async (email: string, expected: number) => {
      for (let attempt = 0; attempt < 40; attempt++) {
        const count = await prisma.message.count({ where: { templateKey: 'account.already-registered', toAddress: email } });
        if (count >= expected) return count;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      return prisma.message.count({ where: { templateKey: 'account.already-registered', toAddress: email } });
    };

    it('emails the owner a way in, once however often it is tried', async () => {
      await prisma.messageTemplate.create({
        data: {
          organizationId: null,
          key: 'account.already-registered',
          channel: MessageChannel.EMAIL,
          subject: { en: 'You already have an account' },
          body: { en: '{{name}} — {{link}} — {{resetLink}}' },
        },
      });
      await register();

      for (let attempt = 0; attempt < 3; attempt++) {
        await http().post('/api/v1/auth/register').send({ ...owner, password: 'someone-elses-password' }).expect(202);
      }

      expect(await noticesTo(owner.email, 1)).toBe(1);
      const notice = await prisma.message.findFirstOrThrow({ where: { templateKey: 'account.already-registered' } });
      expect(notice.body).toContain('/sign-in');
      expect(notice.body).not.toContain('token=');
    });
  });

  describe('password reset', () => {
    // Answering differently for a known and an unknown address is a free
    // account-enumeration oracle.
    it.each([
      { label: 'a known address', email: owner.email },
      { label: 'an unknown address', email: 'nobody@test.local' },
    ])('reports success for $label', async ({ email }) => {
      await register();

      const { body } = await http()
        .post('/api/v1/auth/password-reset')
        .send({ email })
        .expect(201);

      expect(body.sent).toBe(true);
    });

    /**
     * Outside production the response also carries devLink, which is present
     * only for an address that exists — so development responses DO differ.
     * That is the cost of having no mail transport, and it is confined to
     * development: the field is omitted entirely when NODE_ENV=production,
     * leaving both responses identical where it matters.
     */
    it('omits the development link for an address with no account', async () => {
      await register();

      const unknown = await http()
        .post('/api/v1/auth/password-reset')
        .send({ email: 'nobody@test.local' })
        .expect(201);

      expect(unknown.body).toEqual({ sent: true });
    });

    it('issues a token only for an address that exists', async () => {
      await register();
      await http().post('/api/v1/auth/password-reset').send({ email: 'nobody@test.local' }).expect(201);

      expect(await prisma.verificationToken.count()).toBe(0);
    });

    it('sets a new password and lets the user log in with it', async () => {
      await register();
      const requested = await http()
        .post('/api/v1/auth/password-reset')
        .send({ email: owner.email })
        .expect(201);
      const token = tokenFrom(requested.body);

      await http()
        .post('/api/v1/auth/password-reset/confirm')
        .send({ token, password: 'a-brand-new-password' })
        .expect(201);

      await http()
        .post('/api/v1/auth/login')
        .send({ email: owner.email, password: 'a-brand-new-password' })
        .expect(201);
      await http()
        .post('/api/v1/auth/login')
        .send({ email: owner.email, password: owner.password })
        .expect(401);
    });

    // A reset is what someone does when they think an account is compromised.
    it('revokes every existing session', async () => {
      const { user } = await register();
      const requested = await http()
        .post('/api/v1/auth/password-reset')
        .send({ email: owner.email })
        .expect(201);
      const token = tokenFrom(requested.body);

      await http()
        .post('/api/v1/auth/password-reset/confirm')
        .send({ token, password: 'a-brand-new-password' })
        .expect(201);

      const live = await prisma.session.count({ where: { userId: user.id, revokedAt: null } });
      expect(live).toBe(0);
    });

    it('refuses to spend the same link twice', async () => {
      await register();
      const requested = await http()
        .post('/api/v1/auth/password-reset')
        .send({ email: owner.email })
        .expect(201);
      const token = tokenFrom(requested.body);

      await http().post('/api/v1/auth/password-reset/confirm').send({ token, password: 'first-password-x' }).expect(201);
      await http().post('/api/v1/auth/password-reset/confirm').send({ token, password: 'second-password' }).expect(400);
    });

    it('invalidates an earlier link when a new one is requested', async () => {
      await register();
      const requested = await http()
        .post('/api/v1/auth/password-reset')
        .send({ email: owner.email })
        .expect(201);
      const first = tokenFrom(requested.body);

      await http().post('/api/v1/auth/password-reset').send({ email: owner.email }).expect(201);

      await http()
        .post('/api/v1/auth/password-reset/confirm')
        .send({ token: first, password: 'should-not-work-x' })
        .expect(400);
    });

    it('refuses an expired link', async () => {
      const { user } = await register();
      const requested = await http()
        .post('/api/v1/auth/password-reset')
        .send({ email: owner.email })
        .expect(201);
      const token = tokenFrom(requested.body);
      await prisma.verificationToken.updateMany({
        where: { userId: user.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await http()
        .post('/api/v1/auth/password-reset/confirm')
        .send({ token, password: 'a-valid-new-password' })
        .expect(400);
    });

    it('refuses a token that was never issued', async () => {
      await http()
        .post('/api/v1/auth/password-reset/confirm')
        .send({ token: 'f'.repeat(64), password: 'a-valid-new-password' })
        .expect(400);
    });
  });

  describe('organization invitations', () => {
    const asOwner = async () => {
      const { tokens, user } = await register();
      await prisma.messageTemplate.create({ data: { key: 'organization.invite', channel: 'EMAIL', body: { en: '{{link}}' } } });
      const organization = await prisma.organization.create({ data: { name: 'Acme Events' } });
      await prisma.organizationMembership.create({
        data: { userId: user.id, organizationId: organization.id, role: 'OWNER' },
      });
      return { authorization: `Bearer ${tokens.accessToken}`, organization, user };
    };



    it('lets an owner invite someone and lists it as pending', async () => {
      const { authorization } = await asOwner();

      await http()
        .post('/api/v1/organization/invites')
        .set('Authorization', authorization)
        .send({ email: 'new@test.local', role: 'MEMBER' })
        .expect(201);

      const { body } = await http()
        .get('/api/v1/organization/invites')
        .set('Authorization', authorization)
        .expect(200);
      expect(body).toHaveLength(1);
      expect(body[0]).toMatchObject({ email: 'new@test.local', role: 'MEMBER' });
    });

    it('refuses an invitation from an account without member:manage', async () => {
      const { tokens, user } = await register();
      const organization = await prisma.organization.create({ data: { name: 'Acme' } });
      await prisma.organizationMembership.create({
        data: { userId: user.id, organizationId: organization.id, role: 'VIEWER' },
      });

      await http()
        .post('/api/v1/organization/invites')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ email: 'new@test.local', role: 'MEMBER' })
        .expect(403);
    });

    it('creates the account and the membership together on acceptance', async () => {
      const { authorization, organization } = await asOwner();
      const invited = await http()
        .post('/api/v1/organization/invites')
        .set('Authorization', authorization)
        .send({ email: 'new@test.local', role: 'MANAGER' })
        .expect(201);
      const token = tokenFrom(invited.body);

      const { body } = await http()
        .post('/api/v1/invites/accept')
        .send({ token, name: 'New Person', password: 'a-long-enough-password' })
        .expect(201);

      expect(body).toMatchObject({ role: 'MANAGER', accountCreated: true });
      const member = await prisma.user.findUniqueOrThrow({ where: { email: 'new@test.local' } });
      const membership = await prisma.organizationMembership.findFirstOrThrow({
        where: { userId: member.id, organizationId: organization.id },
      });
      expect(membership.role).toBe('MANAGER');
    });

    /**
     * Account squatting. With no proof of who owns an address, someone could
     * register the invitee's email first; the real invitee's acceptance then
     * attached the membership to the squatter's login and threw their own
     * password away.
     */
    describe('when an account already exists for the invited address', () => {
      const inviteAlice = async () => {
        const { authorization, organization } = await asOwner();
        const invited = await http()
          .post('/api/v1/organization/invites')
          .set('Authorization', authorization)
          .send({ email: 'alice@test.local', role: 'MANAGER' })
          .expect(201);
        return { organization, token: tokenFrom(invited.body) };
      };
      const membershipsOf = async (email: string) =>
        prisma.organizationMembership.count({ where: { user: { email } } });

      it('refuses to attach the membership without that account’s password', async () => {
        await register({ email: 'alice@test.local', password: 'the-squatters-password', name: 'Not Alice' });
        const { token } = await inviteAlice();

        const { body } = await http()
          .post('/api/v1/invites/accept')
          .send({ token, name: 'Alice', password: 'alices-own-password' })
          .expect(409);

        expect(body.message).toMatch(/sign in|reset/i);
        expect(await membershipsOf('alice@test.local')).toBe(0);
        // Still usable: the real invitee can come back once they hold the account.
        const invite = await prisma.organizationInvite.findFirstOrThrow({ where: { email: 'alice@test.local' } });
        expect(invite.acceptedAt).toBeNull();
      });

      it('accepts for an existing account given its password', async () => {
        await register({ email: 'alice@test.local', password: 'alices-own-password', name: 'Alice' });
        const { token, organization } = await inviteAlice();

        const { body } = await http()
          .post('/api/v1/invites/accept')
          .send({ token, name: 'Alice', password: 'alices-own-password' })
          .expect(201);

        expect(body).toMatchObject({ organizationId: organization.id, accountCreated: false });
        expect(await membershipsOf('alice@test.local')).toBe(1);
      });

      // The way back for the real owner of the inbox: a reset reaches only them,
      // replaces the squatter's password and signs the squatter out everywhere.
      it('lets the inbox’s owner take the account back with a reset, then accept', async () => {
        const squatter = await register({ email: 'alice@test.local', password: 'the-squatters-password', name: 'Not Alice' });
        const { token } = await inviteAlice();
        const reset = await http().post('/api/v1/auth/password-reset').send({ email: 'alice@test.local' }).expect(201);
        await http()
          .post('/api/v1/auth/password-reset/confirm')
          .send({ token: tokenFrom(reset.body), password: 'alices-own-password' })
          .expect(201);

        await http()
          .post('/api/v1/invites/accept')
          .send({ token, name: 'Alice', password: 'alices-own-password' })
          .expect(201);

        // Their session is revoked; an access token already issued lapses within its 15 minutes.
        const { refreshToken } = squatter.tokens as unknown as { refreshToken: string };
        await http().post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
        expect(await membershipsOf('alice@test.local')).toBe(1);
      });
    });

    it('replays an accepted invitation only with current password proof', async () => {
      const { authorization } = await asOwner();
      const invited = await http()
        .post('/api/v1/organization/invites')
        .set('Authorization', authorization)
        .send({ email: 'new@test.local', role: 'MEMBER' })
        .expect(201);
      const token = tokenFrom(invited.body);
      const accept = { token, name: 'New Person', password: 'a-long-enough-password' };

      await http().post('/api/v1/invites/accept').send(accept).expect(201);
      await http().post('/api/v1/invites/accept').send({ ...accept, password: 'a-different-password' }).expect(409);
      const replay = await http().post('/api/v1/invites/accept').send(accept).expect(201);
      expect(replay.body).toMatchObject({ ok: true, role: 'MEMBER', accountCreated: false });
      expect(await prisma.organizationMembership.count({ where: { user: { email: 'new@test.local' } } })).toBe(1);
    });

    // B87: accepting checked the invite, then wrote; a revoke between the two was ignored.
    it('lets a revoke and an accept arriving together settle one way only', async () => {
      const { authorization } = await asOwner();
      const invited = await http()
        .post('/api/v1/organization/invites')
        .set('Authorization', authorization)
        .send({ email: 'new@test.local', role: 'MEMBER' })
        .expect(201);
      const token = tokenFrom(invited.body);

      const [accepted, revoked] = await Promise.all([
        http().post('/api/v1/invites/accept').send({ token, name: 'New Person', password: 'a-long-enough-password' }),
        http().delete('/api/v1/organization/invites/new@test.local').set('Authorization', authorization),
      ]);

      const invite = await prisma.organizationInvite.findFirstOrThrow({ where: { email: 'new@test.local' } });
      const joined = await prisma.organizationMembership.count({ where: { user: { email: 'new@test.local' } } });
      expect(invite.acceptedAt !== null && invite.revokedAt !== null).toBe(false);
      expect(joined).toBe(accepted.status === 201 ? 1 : 0);
      expect(accepted.status).toBe(invite.acceptedAt ? 201 : 400);
      expect(revoked.status).toBeLessThan(500);
    });

    it('refuses a revoked invitation', async () => {
      const { authorization } = await asOwner();
      const invited = await http()
        .post('/api/v1/organization/invites')
        .set('Authorization', authorization)
        .send({ email: 'new@test.local', role: 'MEMBER' })
        .expect(201);
      const token = tokenFrom(invited.body);

      await http()
        .delete('/api/v1/organization/invites/new@test.local')
        .set('Authorization', authorization)
        .expect(200);

      await http()
        .post('/api/v1/invites/accept')
        .send({ token, name: 'New Person', password: 'a-long-enough-password' })
        .expect(400);
    });

    // Re-inviting must not leave two working links.
    it('replaces an earlier invitation rather than adding a second', async () => {
      const { authorization } = await asOwner();
      const invited = await http()
        .post('/api/v1/organization/invites')
        .set('Authorization', authorization)
        .send({ email: 'new@test.local', role: 'MEMBER' })
        .expect(201);
      const first = tokenFrom(invited.body);

      await http()
        .post('/api/v1/organization/invites')
        .set('Authorization', authorization)
        .send({ email: 'new@test.local', role: 'MANAGER' })
        .expect(201);

      expect(await prisma.organizationInvite.count()).toBe(1);
      await http()
        .post('/api/v1/invites/accept')
        .send({ token: first, name: 'New', password: 'a-long-enough-password' })
        .expect(400);
    });

    it('refuses to invite someone who is already a member', async () => {
      const { authorization } = await asOwner();

      await http()
        .post('/api/v1/organization/invites')
        .set('Authorization', authorization)
        .send({ email: owner.email, role: 'MEMBER' })
        .expect(400);
    });
  });
});
