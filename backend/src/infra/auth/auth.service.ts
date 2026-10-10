import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { hashRefreshToken, isExpired, newRefreshToken } from './token.util';

/** A valid hash of a random string nobody knows, at the cost real hashes use. */
/** A replaced refresh token resent this soon is a retry, not theft. */
const REUSE_GRACE_MS = 60_000;

const TIMING_DUMMY_HASH = '$2b$12$Clb6dFgAWHxEY8ObdDx41.sdr2UKjD7MN7iKsH8bxuvyDb3kVMchG';

const BCRYPT_ROUNDS = 12;

/** What an access token carries. Deliberately minimal: roles that govern a
 *  specific resource are resolved per request, never trusted from a token
 *  minted before the membership changed. */
export interface AccessTokenClaims {
  sub: string;
  email: string;
  platformRole: string;
  /** The account's session generation when issued; absent on older tokens, read as 0. */
  gen?: number;
}

export interface SessionContext {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  private readonly accessTokenTtlSeconds: number;
  private readonly refreshTokenTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    // Seconds rather than a duration string: one less format to get wrong,
    // and it is the unit the response reports anyway.
    this.accessTokenTtlSeconds = Number(config.get<string>('ACCESS_TOKEN_TTL_SECONDS') ?? 900);
    this.refreshTokenTtlMs =
      Number(config.get<string>('REFRESH_TOKEN_TTL_DAYS') ?? 30) * 24 * 60 * 60 * 1000;
  }

  async register(dto: RegisterDto, context: SessionContext) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    // Deliberately the same message as a bad login: whether an address has an
    // account is information worth not leaking.
    if (existing) throw new UnauthorizedException('Could not create that account');

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash: await hash(dto.password, BCRYPT_ROUNDS),
      },
    });

    return this.issueTokens(user, context);
  }

  async login(dto: LoginDto, context: SessionContext) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    // Compare against a dummy hash when the user is unknown, so a missing
    // account and a wrong password take the same time to reject. It must be a
    // real bcrypt hash at the same cost: the old placeholder was malformed,
    // bcrypt rejected it at once, and the time difference said which
    // addresses had accounts.
    const storedHash = user?.passwordHash ?? TIMING_DUMMY_HASH;
    const isCorrect = await compare(dto.password, storedHash);

    if (!user || !user.passwordHash || !isCorrect || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.issueTokens(user, context);
  }

  /**
   * Exchanges a refresh token for a new pair and **rotates** it: the old
   * token is revoked in the same breath. A stolen token is therefore usable
   * at most once, and its use invalidates the victim's session, which is how
   * the theft becomes visible.
   */
  async refresh(refreshToken: string, context: SessionContext) {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashRefreshToken(refreshToken) },
      include: { user: true },
    });
    if (!session || isExpired(session.expiresAt) || !session.user.isActive) {
      throw new UnauthorizedException('Session is no longer valid');
    }
    if (session.revokedAt) {
      await this.treatAsStolenIfStale(session.userId, session.revokedAt);
      throw new UnauthorizedException('Session is no longer valid');
    }
    // From before a password reset or "sign out everywhere": dead, however
    // it was minted — including by a refresh that raced the reset.
    if (session.generation !== session.user.sessionGeneration) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    // The revocation is the claim: conditioned on the session still being
    // live, so of several refreshes racing with one token exactly one wins.
    // Read-then-revoke let each of them mint a session.
    const claimed = await this.prisma.session.updateMany({
      where: { id: session.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) throw new UnauthorizedException('Session is no longer valid');

    return this.issueTokens(session.user, context);
  }

  /**
   * A refresh token used again after it was replaced is the theft rotation
   * exists to reveal: the thief or the owner holds a copy. Every session
   * ends. A retry within a minute — a client resending after a dropped
   * response — is not treated as theft.
   */
  private async treatAsStolenIfStale(userId: string, revokedAt: Date): Promise<void> {
    if (Date.now() - revokedAt.getTime() < REUSE_GRACE_MS) return;
    await this.revokeAllSessions(userId);
    this.logger.warn(`a replaced refresh token for user ${userId} was used again; every session revoked`);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Revokes every session for a user — the "sign out everywhere" action. The
   * generation moves on in the same transaction, so access tokens already
   * issued stop at once, and a session a concurrent refresh mints is born dead.
   */
  async revokeAllSessions(userId: string): Promise<{ revoked: number }> {
    const [result] = await this.prisma.$transaction([
      this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.user.update({ where: { id: userId }, data: { sessionGeneration: { increment: 1 } } }),
    ]);
    return { revoked: result.count };
  }

  /**
   * The generation is the one read before any slow work — the password check,
   * the session lookup — so a reset landing in between leaves these born dead.
   */
  private async issueTokens(
    user: { id: string; email: string; platformRole: string; sessionGeneration: number },
    context: SessionContext,
  ) {
    const refreshToken = newRefreshToken();

    await this.prisma.session.create({
      data: {
        generation: user.sessionGeneration,
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshTokenTtlMs),
        userAgent: context.userAgent ?? null,
        ipAddress: context.ipAddress ?? null,
      },
    });

    const claims: AccessTokenClaims = {
      sub: user.id,
      email: user.email,
      platformRole: user.platformRole,
      gen: user.sessionGeneration,
    };
    const accessToken = await this.jwt.signAsync<AccessTokenClaims>(claims, {
      expiresIn: this.accessTokenTtlSeconds,
    });

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: this.accessTokenTtlSeconds,
    };
  }
}
