import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { hashRefreshToken, isExpired, newRefreshToken } from './token.util';

/** A valid hash of a random string nobody knows, at the cost real hashes use. */
const TIMING_DUMMY_HASH = '$2b$12$Clb6dFgAWHxEY8ObdDx41.sdr2UKjD7MN7iKsH8bxuvyDb3kVMchG';

const BCRYPT_ROUNDS = 12;

/** What an access token carries. Deliberately minimal: roles that govern a
 *  specific resource are resolved per request, never trusted from a token
 *  minted before the membership changed. */
export interface AccessTokenClaims {
  sub: string;
  email: string;
  platformRole: string;
}

export interface SessionContext {
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class AuthService {
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

    if (!session || session.revokedAt || isExpired(session.expiresAt) || !session.user.isActive) {
      throw new UnauthorizedException('Session is no longer valid');
    }

    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(session.user, context);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { tokenHash: hashRefreshToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Revokes every session for a user — the "sign out everywhere" action. */
  async revokeAllSessions(userId: string): Promise<{ revoked: number }> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: result.count };
  }

  private async issueTokens(
    user: { id: string; email: string; platformRole: string },
    context: SessionContext,
  ) {
    const refreshToken = newRefreshToken();

    await this.prisma.session.create({
      data: {
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
