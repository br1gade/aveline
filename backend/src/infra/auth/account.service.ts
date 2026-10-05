import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { VerificationPurpose } from '@prisma/client';
import { hash } from 'bcryptjs';
import { PrismaService } from '../../prisma/prisma.service';
import { hashRefreshToken, isExpired, newRefreshToken } from './token.util';
import { AcceptInviteDto, InviteMemberDto } from './dto/account.dto';

const BCRYPT_ROUNDS = 12;
const RESET_LIFETIME_MS = 60 * 60 * 1000;
const VERIFICATION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const INVITE_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * The parts of an account's life that are not logging in: recovering a
 * password, proving an address, and joining an organization.
 *
 * All three hand out a single-use token and store only its hash, for the same
 * reason sessions do — a database leak must not let someone take over an
 * account.
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);
  private readonly appUrl: string;
  private readonly isProduction: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.appUrl = config.get<string>('PUBLIC_APP_URL') ?? 'http://localhost:5173';
    this.isProduction = config.get<string>('NODE_ENV') === 'production';
  }

  /**
   * Returns the link itself outside production.
   *
   * No transport delivers mail yet, so without this a developer cannot
   * complete a password reset or accept an invitation at all. Guarded on
   * NODE_ENV rather than a feature flag, because a flag left on in production
   * would hand out account-takeover links over HTTP.
   */
  private devLink(path: string, token: string): { devLink?: string } {
    return this.isProduction ? {} : { devLink: `${this.appUrl}${path}?token=${token}` };
  }

  /**
   * Starts a password reset.
   *
   * Returns the same answer whether or not the address has an account.
   * Telling the caller which is a free account-enumeration oracle, and the
   * person who legitimately forgot their password learns nothing from it
   * either — they check their inbox regardless.
   */
  async requestPasswordReset(email: string) {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.isActive || user.deletedAt !== null) return { sent: true as const };

    const token = await this.issueToken(
      user.id,
      VerificationPurpose.PASSWORD_RESET,
      RESET_LIFETIME_MS,
    );
    this.logger.log(`password reset issued for ${user.id}`);

    // TODO(transport): enqueue through CommunicationsService once a real
    // transport exists.
    return { sent: true as const, ...this.devLink('/reset-password', token) };
  }

  /** Completes a reset and revokes every session, because a reset is what
   *  someone does when they believe an account is compromised. */
  async confirmPasswordReset(token: string, password: string) {
    const record = await this.consumeToken(token, VerificationPurpose.PASSWORD_RESET);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: await hash(password, BCRYPT_ROUNDS) },
      }),
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { ok: true as const, sessionsRevoked: true as const };
  }

  async requestEmailVerification(userId: string) {
    const token = await this.issueToken(
      userId,
      VerificationPurpose.EMAIL_VERIFICATION,
      VERIFICATION_LIFETIME_MS,
    );
    return { sent: true as const, ...this.devLink('/verify-email', token) };
  }

  async verifyEmail(token: string) {
    const record = await this.consumeToken(token, VerificationPurpose.EMAIL_VERIFICATION);
    return { ok: true as const, userId: record.userId };
  }

  // ── organization invitations ─────────────────────────────────────────

  /**
   * Invites someone to an organization by email.
   *
   * Re-inviting replaces the previous invitation rather than adding a second,
   * so the most recent link is the only one that works — which is what a
   * person expects after asking for the email again.
   */
  async inviteMember(organizationId: string, invitedByUserId: string, dto: InviteMemberDto) {
    const alreadyMember = await this.prisma.organizationMembership.findFirst({
      where: { organizationId, user: { email: dto.email } },
    });
    if (alreadyMember) throw new BadRequestException('That person is already a member');

    const token = newRefreshToken();
    await this.prisma.organizationInvite.upsert({
      where: { organizationId_email: { organizationId, email: dto.email } },
      create: {
        organizationId,
        email: dto.email,
        role: dto.role,
        invitedByUserId,
        tokenHash: hashRefreshToken(token),
        expiresAt: new Date(Date.now() + INVITE_LIFETIME_MS),
      },
      update: {
        role: dto.role,
        invitedByUserId,
        tokenHash: hashRefreshToken(token),
        expiresAt: new Date(Date.now() + INVITE_LIFETIME_MS),
        acceptedAt: null,
        revokedAt: null,
      },
    });

    return {
      sent: true as const,
      email: dto.email,
      role: dto.role,
      ...this.devLink('/accept-invite', token),
    };
  }

  /**
   * Accepts an invitation, creating the account if the invitee has none.
   *
   * The membership and the account are created together: a half-accepted
   * invitation would leave someone with a login and no reason to have one.
   */
  async acceptInvite(dto: AcceptInviteDto) {
    const invite = await this.prisma.organizationInvite.findUnique({
      where: { tokenHash: hashRefreshToken(dto.token) },
    });

    if (!invite || invite.revokedAt || invite.acceptedAt || isExpired(invite.expiresAt)) {
      throw new BadRequestException('This invitation is no longer valid');
    }

    const existing = await this.prisma.user.findUnique({ where: { email: invite.email } });
    const passwordHash = await hash(dto.password, BCRYPT_ROUNDS);

    const membership = await this.prisma.$transaction(async (tx) => {
      const user =
        existing ??
        (await tx.user.create({ data: { email: invite.email, name: dto.name, passwordHash } }));

      await tx.organizationInvite.update({
        where: { id: invite.id },
        data: { acceptedAt: new Date() },
      });

      return tx.organizationMembership.upsert({
        where: { userId_organizationId: { userId: user.id, organizationId: invite.organizationId } },
        create: { userId: user.id, organizationId: invite.organizationId, role: invite.role },
        update: { role: invite.role },
      });
    });

    return {
      ok: true as const,
      organizationId: membership.organizationId,
      role: membership.role,
      accountCreated: existing === null,
    };
  }

  async revokeInvite(organizationId: string, email: string) {
    const revoked = await this.prisma.organizationInvite.updateMany({
      where: { organizationId, email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) throw new NotFoundException('No pending invitation for that address');
    return { ok: true as const };
  }

  listInvites(organizationId: string) {
    return this.prisma.organizationInvite.findMany({
      where: { organizationId, acceptedAt: null, revokedAt: null },
      select: { email: true, role: true, expiresAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── internals ────────────────────────────────────────────────────────

  /** Replaces any outstanding token for the same purpose, so an old link
   *  stops working the moment a new one is asked for. */
  private async issueToken(userId: string, purpose: VerificationPurpose, lifetimeMs: number) {
    const token = newRefreshToken();

    await this.prisma.$transaction([
      this.prisma.verificationToken.deleteMany({ where: { userId, purpose, usedAt: null } }),
      this.prisma.verificationToken.create({
        data: {
          userId,
          purpose,
          tokenHash: hashRefreshToken(token),
          expiresAt: new Date(Date.now() + lifetimeMs),
        },
      }),
    ]);

    return token;
  }

  /**
   * Spends a token. The update is conditional on it being unused, so two
   * concurrent requests cannot both redeem the same link.
   */
  private async consumeToken(token: string, purpose: VerificationPurpose) {
    const record = await this.prisma.verificationToken.findUnique({
      where: { tokenHash: hashRefreshToken(token) },
    });

    if (!record || record.purpose !== purpose || record.usedAt || isExpired(record.expiresAt)) {
      throw new BadRequestException('This link is invalid or has expired');
    }

    const consumed = await this.prisma.verificationToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (consumed.count === 0) throw new BadRequestException('This link has already been used');

    return record;
  }
}
