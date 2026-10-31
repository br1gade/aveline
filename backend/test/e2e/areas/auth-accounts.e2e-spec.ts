import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { hashRefreshToken } from '../../../src/infra/auth/token.util';
import { accountsApp, http as httpOf, tokenFrom } from '../../fixtures/areas/auth-accounts.fixture';
import { disconnectTestDatabase, resetTestDatabase, testPrisma } from '../../setup/test-database';

/**
 * Signing in, keeping a session and proving an address: the parts of
 * docs/API.md §2 and ACCESS_CONTROL.md §5 that decide whether a token still
 * opens the door.
 */
describe('Sessions and account verification (e2e coverage)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

  const http = () => httpOf(app);
  const credentials = { email: 'owner@test.local', password: 'a-long-enough-password', name: 'Owner' };
  const login = () => http().post('/api/v1/auth/login').send({ email: credentials.email, password: credentials.password });
  const signUp = async () => {
    await http().post('/api/v1/auth/register').send(credentials).expect(202);
    const { body } = await login().expect(201);
    return body as { accessToken: string; refreshToken: string };
  };
  const refresh = (refreshToken: string) => http().post('/api/v1/auth/refresh').send({ refreshToken });
  // Any signed-in route will do: the guard is what is under test.
  const events = (accessToken: string) => http().get('/api/v1/events').set('Authorization', `Bearer ${accessToken}`);
  const sessionOf = (refreshToken: string) =>
    prisma.session.findUniqueOrThrow({ where: { tokenHash: hashRefreshToken(refreshToken) } });

  beforeAll(async () => {
    prisma = testPrisma();
    app = await accountsApp(prisma);
  });
  beforeEach(() => resetTestDatabase());
  afterAll(async () => {
    await app.close();
    await disconnectTestDatabase();
  });

  describe('a deactivated account', () => {
    const deactivate = () => prisma.user.update({ where: { email: credentials.email }, data: { isActive: false } });

    it('cannot log in with the right password, and is told nothing more than a wrong one', async () => {
      await signUp();
      await deactivate();

      const response = await login().expect(401);

      expect(response.body.message).toBe('Invalid email or password');
    });

    it('creates no session when a deactivated account logs in', async () => {
      await signUp();
      await deactivate();
      const before = await prisma.session.count();

      await login().expect(401);

      expect(await prisma.session.count()).toBe(before);
    });

    it('refuses an access token issued before the account was deactivated', async () => {
      const tokens = await signUp();
      await events(tokens.accessToken).expect(200);
      await deactivate();

      const response = await events(tokens.accessToken).expect(401);

      expect(response.body.message).toBe('Account is not active');
    });

    it('refuses to refresh a session issued before the account was deactivated, minting no new one', async () => {
      const tokens = await signUp();
      await deactivate();

      const response = await refresh(tokens.refreshToken).expect(401);

      expect(response.body.message).toBe('Session is no longer valid');
      expect(await prisma.session.count()).toBe(1);
    });
  });

  describe('refresh token reuse', () => {
    // A client resending after a dropped response is not a thief.
    it('refuses a replaced token resent within the grace minute without signing the account out', async () => {
      const first = await signUp();
      const { body: second } = await refresh(first.refreshToken).expect(201);

      await refresh(first.refreshToken).expect(401);

      await events(second.accessToken as string).expect(200);
      await refresh(second.refreshToken as string).expect(201);
    });

    it('keeps the account’s other sessions live after a resend within the grace minute', async () => {
      const first = await signUp();
      await login().expect(201);
      await refresh(first.refreshToken).expect(201);

      await refresh(first.refreshToken).expect(401);

      expect(await prisma.session.count({ where: { revokedAt: null } })).toBe(2);
    });

    it('ends only the session that logs out, leaving another session working', async () => {
      const a = await signUp();
      const { body: b } = await login().expect(201);

      await http().post('/api/v1/auth/logout').send({ refreshToken: a.refreshToken }).expect(201);

      await refresh(a.refreshToken).expect(401);
      await events(b.accessToken as string).expect(200);
      await refresh(b.refreshToken as string).expect(201);
    });

    // ACCESS_CONTROL.md §5: a token presented after its own logout still counts as reuse.
    it('treats a logged-out token presented after the grace minute as theft and ends every session', async () => {
      const a = await signUp();
      const { body: b } = await login().expect(201);
      await http().post('/api/v1/auth/logout').send({ refreshToken: a.refreshToken }).expect(201);
      const { body: rotated } = await refresh(b.refreshToken as string).expect(201);
      const loggedOut = await sessionOf(a.refreshToken);
      await prisma.session.update({ where: { id: loggedOut.id }, data: { revokedAt: new Date(Date.now() - 5 * 60_000) } });

      await refresh(a.refreshToken).expect(401);

      expect((await sessionOf(rotated.refreshToken as string)).revokedAt).not.toBeNull();
      await events(rotated.accessToken as string).expect(401);
      await refresh(rotated.refreshToken as string).expect(401);
    });

    it('keeps the logged-out session row rather than deleting it, so later reuse is still recognised', async () => {
      const tokens = await signUp();

      await http().post('/api/v1/auth/logout').send({ refreshToken: tokens.refreshToken }).expect(201);

      expect((await sessionOf(tokens.refreshToken)).revokedAt).not.toBeNull();
    });
  });

  describe('an expired refresh token', () => {
    it('is refused and mints no new session', async () => {
      const tokens = await signUp();
      await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

      const response = await refresh(tokens.refreshToken).expect(401);

      expect(response.body.message).toBe('Session is no longer valid');
      expect(await prisma.session.count()).toBe(1);
    });

    it('still refreshes a moment before it expires', async () => {
      const tokens = await signUp();
      await prisma.session.updateMany({ data: { expiresAt: new Date(Date.now() + 60_000) } });

      await refresh(tokens.refreshToken).expect(201);
    });
  });

  describe('confirming an email address', () => {
    const requestVerification = async (accessToken: string) => {
      const { body } = await http()
        .post('/api/v1/auth/verify-email')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(201);
      return tokenFrom(body);
    };
    const requestReset = async () => {
      const { body } = await http().post('/api/v1/auth/password-reset').send({ email: credentials.email }).expect(201);
      return tokenFrom(body);
    };
    const confirm = (token: string) => http().post('/api/v1/auth/verify-email/confirm').send({ token });

    it('confirms with the emailed token and names the account', async () => {
      const tokens = await signUp();
      const user = await prisma.user.findUniqueOrThrow({ where: { email: credentials.email } });

      const { body } = await confirm(await requestVerification(tokens.accessToken)).expect(201);

      expect(body).toEqual({ ok: true, userId: user.id });
    });

    it('refuses the same verification token a second time', async () => {
      const tokens = await signUp();
      const token = await requestVerification(tokens.accessToken);
      await confirm(token).expect(201);

      const response = await confirm(token).expect(400);

      expect(response.body.message).toMatch(/invalid or has expired/);
    });

    it('refuses an expired verification token', async () => {
      const tokens = await signUp();
      const token = await requestVerification(tokens.accessToken);
      await prisma.verificationToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });

      const response = await confirm(token).expect(400);

      expect(response.body.message).toBe('This link is invalid or has expired');
    });

    it('stops an earlier verification link working once a new one is asked for', async () => {
      const tokens = await signUp();
      const earlier = await requestVerification(tokens.accessToken);
      const later = await requestVerification(tokens.accessToken);

      const response = await confirm(earlier).expect(400);

      expect(response.body.message).toBe('This link is invalid or has expired');
      await confirm(later).expect(201);
    });

    it('refuses a password-reset token presented as a verification, and leaves it usable for the reset', async () => {
      await signUp();
      const resetToken = await requestReset();

      const response = await confirm(resetToken).expect(400);

      expect(response.body.message).toBe('This link is invalid or has expired');

      await http()
        .post('/api/v1/auth/password-reset/confirm')
        .send({ token: resetToken, password: 'a-brand-new-password' })
        .expect(201);
    });

    it('refuses a verification token presented as a password reset, and keeps the old password', async () => {
      const tokens = await signUp();
      const verificationToken = await requestVerification(tokens.accessToken);

      await http()
        .post('/api/v1/auth/password-reset/confirm')
        .send({ token: verificationToken, password: 'a-brand-new-password' })
        .expect(400);

      await login().expect(201);
    });

    it('needs a signed-in account to ask for a verification link', async () => {
      await http().post('/api/v1/auth/verify-email').expect(401);
    });

    it('names the token field when it is too short to be one', async () => {
      const response = await confirm('short').expect(400);

      expect(response.body.details).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'token' })]));
    });
  });
});
