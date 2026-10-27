import { lockOwnerAddress, lockOrganizationStanding, lockEventOrganization, requireCurrentOrganizationPermission, requireCurrentEventPermission } from './access-locks';
import { canAddOrganizationMembership } from './organization-write-gate';
import { incrementOrganizationRevision } from '../../modules/organizations/organization-membership';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, VerificationPurpose } from '@prisma/client';
import { compare, hash } from 'bcrypt';
import { MessageChannel } from '@prisma/client';
import { CommunicationsService } from '../../modules/communications/communications.service';
import { allowsDevelopmentShortcuts } from '../../common/environment';
import { PrismaService } from '../../prisma/prisma.service';
import { hashRefreshToken, isExpired, newRefreshToken } from './token.util';
import { AcceptInviteDto, InviteMemberDto, InviteToEventDto } from './dto/account.dto';
import { RegisterDto } from './dto/auth.dto';
import { isUniqueViolation } from '../../common/prisma-errors';

const BCRYPT_ROUNDS = 12;
const RESET_LIFETIME_MS = 60 * 60 * 1000;
const VERIFICATION_LIFETIME_MS = 24 * 60 * 60 * 1000;
const INVITE_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
/** At most one "you already have an account" email per account in this window. */
const ALREADY_REGISTERED_NOTICE_MS = 60 * 60 * 1000;

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
  private readonly defaultLocale: string;
  private readonly isDevelopmentLinkAllowed: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly communications: CommunicationsService,
    config: ConfigService,
  ) {
    this.appUrl = config.get<string>('PUBLIC_APP_URL') ?? 'http://localhost:5173';
    // Account mail has no event to take a locale from and no stored
    // preference to read at reset time, so it uses the platform default.
    this.defaultLocale = config.get<string>('DEFAULT_LOCALE') ?? 'hy';
    this.isDevelopmentLinkAllowed = allowsDevelopmentShortcuts(config.get<string>('NODE_ENV'));
  }

  /**
   * Sends an account email through the outbox.
   *
   * Through the outbox rather than straight to a transport, so these get the
   * same retry on a temporary failure, the same suppression check and the same
   * bounce handling as every other message — and so a host asking "did the
   * invite go out?" has a `Message` row to point at.
   *
   * `organizationId` is null for a reset and a verification, which belong to
   * no tenant. An invite carries one, because the organization is the thing
   * being joined.
   *
   * A failure here is logged and swallowed. The caller has already issued the
   * token, and a 500 would tell the user their reset failed when the next
   * dispatch sweep will still deliver it. The response is deliberately the
   * same either way, because it is also the same for an address that has no
   * account — see `requestPasswordReset`.
   */
  private async mail(params: {
    templateKey: string;
    toAddress: string;
    variables: Record<string, string>;
    organizationId?: string;
    dedupeKey?: string;
  }): Promise<void> {
    try {
      await this.communications.enqueue({
        organizationId: params.organizationId ?? null,
        channel: MessageChannel.EMAIL,
        templateKey: params.templateKey,
        toAddress: params.toAddress,
        locale: this.defaultLocale,
        variables: params.variables,
        dedupeKey: params.dedupeKey,
      });
    } catch (error) {
      this.logger.error(
        `could not queue ${params.templateKey} to ${params.toAddress}: ${describeError(error)}`,
      );
    }
  }

  private linkFor(path: string, token: string): string {
    return `${this.appUrl}${path}?token=${token}`;
  }

  /**
   * Returns the link itself outside production.
   *
   * No transport delivers mail yet, so without this a developer cannot
   * complete a password reset or accept an invitation at all. Guarded on
   * NODE_ENV rather than a feature flag, because a flag left on in production
   * would hand out account-takeover links over HTTP — and only on an explicit
   * development value, so an unset NODE_ENV cannot turn it on.
   */
  private devLink(path: string, token: string): { devLink?: string } {
    return this.isDevelopmentLinkAllowed ? { devLink: this.linkFor(path, token) } : {};
  }

  /**
   * Creates an account — and answers exactly the same when the address
   * already has one (decided 10 October 2026).
   *
   * Refusing an existing address told anyone which addresses hold accounts.
   * So both paths hash the password, both return the same body, and the
   * owner of an existing account is emailed a way in instead; a typo'd sign-up
   * by the real owner still ends with them signed in. Nothing here signs
   * anyone in: the client logs in next, which is also what proves the
   * password belongs to whoever is at the keyboard.
   */
  async register(dto: RegisterDto) {
    const passwordHash = await hash(dto.password, BCRYPT_ROUNDS);
    try {
      await this.prisma.user.create({ data: { email: dto.email, name: dto.name, passwordHash } });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // Not awaited: the extra queries would make this path measurably
      // slower than a real sign-up, which is the same leak by a clock.
      void this.noticeRegistrationAttempt(dto.email).catch((noticeError: unknown) =>
        this.logger.error(`could not notice a repeat registration: ${describeError(noticeError)}`),
      );
    }
    return { accepted: true as const };
  }

  private async noticeRegistrationAttempt(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, name: true, email: true, isActive: true, deletedAt: true },
    });
    if (!user?.isActive || user.deletedAt !== null) return;

    // One per hour per account, so a script cannot fill someone's inbox.
    const window = Math.floor(Date.now() / ALREADY_REGISTERED_NOTICE_MS);
    await this.mail({
      templateKey: 'account.already-registered',
      toAddress: user.email,
      variables: {
        name: user.name ?? user.email,
        link: `${this.appUrl}/sign-in`,
        resetLink: `${this.appUrl}/reset-password`,
      },
      dedupeKey: `account.already-registered:${user.id}:${window}`,
    });
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
    await this.mail({
      templateKey: 'account.password-reset',
      toAddress: user.email,
      variables: { name: user.name ?? user.email, link: this.linkFor('/reset-password', token) },
    });

    this.logger.log(`password reset issued for ${user.id}`);
    return { sent: true as const, ...this.devLink('/reset-password', token) };
  }

  /** Completes a reset and revokes every session, because a reset is what
   *  someone does when they believe an account is compromised. */
  async confirmPasswordReset(token: string, password: string) {
    const record = await this.consumeToken(token, VerificationPurpose.PASSWORD_RESET);

    await this.prisma.$transaction([
      // The generation moves on with the password: every session and access
      // token from before is refused at once, including one a concurrent
      // login or refresh is minting right now.
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: await hash(password, BCRYPT_ROUNDS), sessionGeneration: { increment: 1 } },
      }),
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { ok: true as const, sessionsRevoked: true as const };
  }

  async requestEmailVerification(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { email: true, name: true },
    });
    const token = await this.issueToken(
      userId,
      VerificationPurpose.EMAIL_VERIFICATION,
      VERIFICATION_LIFETIME_MS,
    );

    await this.mail({
      templateKey: 'account.verify-email',
      toAddress: user.email,
      variables: { name: user.name ?? user.email, link: this.linkFor('/verify-email', token) },
    });

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
    return this.prisma.$transaction(async (tx) => {
      if (dto.role === 'OWNER') await lockOwnerAddress(tx, dto.email);
      return this.inviteMemberInTransaction(tx, { organizationId, invitedByUserId, dto });
    }, { timeout: 10_000, maxWait: 5000 });
  }

  async inviteMemberInTransaction(tx: Prisma.TransactionClient, input: { organizationId: string; invitedByUserId: string; dto: InviteMemberDto; reusePendingOwner?: boolean; isConcierge?: boolean }) {
    const { organizationId, invitedByUserId, dto } = input;
    const email = dto.email.trim().toLowerCase();
    await lockOrganizationStanding(tx, { organizationId, mode: 'update' });
    await tx.$queryRaw`SELECT id FROM organization_invites WHERE "organizationId" = ${organizationId} AND email = ${email} FOR UPDATE`;
    await requireCurrentOrganizationPermission(tx, { actor: { userId: invitedByUserId, email: '', platformRole: 'NONE' }, organizationId, permission: input.isConcierge ? 'concierge:manage' : 'member:manage' });
    const organization = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
    if (await tx.organizationMembership.findFirst({ where: { organizationId, user: { email: { equals: email, mode: 'insensitive' } } }, select: { id: true } })) throw new BadRequestException('That person is already a member');
    const previous = await tx.organizationInvite.findUnique({ where: { organizationId_email: { organizationId, email } } });
    if (previous && input.reusePendingOwner && isPendingOwnerInvite(previous)) {
      const message = await tx.message.findUnique({ where: { dedupeKey: `organization.invite:${previous.tokenHash}` }, select: { id: true, status: true } });
      return { sent: true as const, email, role: previous.role, invitationId: previous.id, messageId: message?.id ?? null, messageStatus: message?.status ?? null, devLink: undefined as string | undefined };
    }
    const token = newRefreshToken();
    const fresh = { role: dto.role, invitedByUserId, tokenHash: hashRefreshToken(token), expiresAt: new Date(Date.now() + INVITE_LIFETIME_MS) };
    const invitation = await tx.organizationInvite.upsert({
      where: { organizationId_email: { organizationId, email } }, create: { organizationId, email, ...fresh },
      update: { ...fresh, acceptedAt: null, acceptedByUserId: null, revokedAt: null },
    });
    const message = await this.communications.enqueueInTransaction(tx, { organizationId, channel: MessageChannel.EMAIL,
      templateKey: 'organization.invite', toAddress: email, locale: this.defaultLocale,
      variables: { organizationName: organization.name, role: dto.role, link: this.linkFor('/accept-invite', token) },
      dedupeKey: `organization.invite:${fresh.tokenHash}`,
    });
    return { sent: true as const, email, role: dto.role, invitationId: invitation.id, messageId: message.id, messageStatus: message.status, ...this.devLink('/accept-invite', token) };
  }

  /**
   * Accepts an invitation, creating the account if the invitee has none.
   *
   * The membership and the account are created together: a half-accepted
   * invitation would leave someone with a login and no reason to have one.
   *
   * An account that already exists must be proven with its own password.
   * Nothing verifies who registered an address, so without this anyone could
   * register the invitee's email first and the real invitee's acceptance
   * would attach the membership to the squatter's login. The real owner of
   * the inbox resets the password — the link reaches only them, and it signs
   * every other session out — and then accepts.
   */
  async acceptInvite(dto: AcceptInviteDto) {
    try { return await this.acceptOrganizationInvitation(dto); }
    catch (error) {
      if (!isUniqueViolation(error)) throw error;
      // A concurrently registered account requires fresh password proof outside
      // the rolled-back transaction; never attach our precomputed password.
      return this.acceptOrganizationInvitation(dto);
    }
  }

  private async acceptOrganizationInvitation(dto: AcceptInviteDto) {
    const tokenHash = hashRefreshToken(dto.token);
    const initial = await this.prisma.organizationInvite.findUnique({ where: { tokenHash } });
    assertValidInvitation(initial);
    const admit = await this.prepareInvitee(initial.email, dto);
    const result = await this.prisma.$transaction(async (tx) => {
      await lockOwnerAddress(tx, initial.email);
      await lockOrganizationStanding(tx, { organizationId: initial.organizationId, mode: 'update' });
      await tx.$queryRaw`SELECT id FROM organization_invites WHERE id = ${initial.id} FOR UPDATE`;
      const invite = await tx.organizationInvite.findUnique({ where: { id: initial.id } });
      assertValidInvitation(invite, tokenHash);
      const canAddMembership = await canAddOrganizationMembership(tx);
      const user = await admit(tx, !canAddMembership);
      const current = await tx.organizationMembership.findUnique({ where: { userId_organizationId: { userId: user.id, organizationId: invite.organizationId } } });
      if (invite.acceptedAt) {
        if (invite.acceptedByUserId !== user.id || !current) throw invalidInvitation();
        return { membership: current, accountCreated: false };
      }
      if (!canAddMembership) await this.assertNoOtherOrganization(tx, user.id, invite.organizationId);
      assertClaimed(await tx.organizationInvite.updateMany({ where: { ...liveInvite(invite.id), tokenHash }, data: { acceptedAt: new Date(), acceptedByUserId: user.id } }));
      const membership = current ?? await tx.organizationMembership.create({ data: { userId: user.id, organizationId: invite.organizationId, role: invite.role } });
      if (!current) await incrementOrganizationRevision(tx, invite.organizationId);
      return { membership, accountCreated: admit.isNewAccount };
    }, { timeout: 10_000, maxWait: 5000 });
    return { ok: true as const, organizationId: result.membership.organizationId, role: result.membership.role, accountCreated: result.accountCreated };
  }

  /**
   * Invites someone to work on one event — a coordinator, a designer, door
   * staff. Accepting grants an event role and nothing in the organization, so
   * they see this event and no other. Re-inviting replaces the earlier link.
   */
  async inviteToEvent(eventId: string, invitedByUserId: string, dto: InviteToEventDto) {
    const email = dto.email.trim().toLowerCase();
    const token = newRefreshToken();
    await this.prisma.$transaction(async (tx) => {
      const organizationId = await lockEventOrganization(tx, eventId);
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM event_invites WHERE "eventId" = ${eventId} AND email = ${email} FOR UPDATE`;
      await requireCurrentEventPermission(tx, { actor: { userId: invitedByUserId }, eventId, permission: 'member:manage' });
      const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { title: true } });
      const existing = await tx.eventMembership.findFirst({ where: { eventId, user: { email: { equals: email, mode: 'insensitive' } } }, select: { id: true } });
      if (existing) throw new BadRequestException("That person is already on this event's team");
      const fresh = { role: dto.role, invitedByUserId, tokenHash: hashRefreshToken(token), expiresAt: new Date(Date.now() + INVITE_LIFETIME_MS) };
      await tx.eventInvite.upsert({ where: { eventId_email: { eventId, email } }, create: { eventId, email, ...fresh }, update: { ...fresh, acceptedAt: null, acceptedByUserId: null, revokedAt: null } });
      await this.communications.enqueueInTransaction(tx, { organizationId, eventId, channel: MessageChannel.EMAIL,
        templateKey: 'event.invite', toAddress: email, locale: this.defaultLocale,
        variables: { eventTitle: event.title, role: dto.role, link: this.linkFor('/accept-event-invite', token) }, dedupeKey: `event.invite:${fresh.tokenHash}` });
    }, { timeout: 10_000, maxWait: 5000 });
    return { sent: true as const, email, role: dto.role, ...this.devLink('/accept-event-invite', token) };
  }

  /** Accepts an event invitation, creating the account if needed — the same rules as joining an organization. */
  async acceptEventInvite(dto: AcceptInviteDto) {
    try { return await this.acceptEventInvitation(dto); }
    catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return this.acceptEventInvitation(dto);
    }
  }

  private async acceptEventInvitation(dto: AcceptInviteDto) {
    const tokenHash = hashRefreshToken(dto.token);
    const initial = await this.prisma.eventInvite.findUnique({ where: { tokenHash } });
    assertValidInvitation(initial);
    const admit = await this.prepareInvitee(initial.email, dto);
    const result = await this.prisma.$transaction(async (tx) => {
      await lockOwnerAddress(tx, initial.email);
      await lockEventOrganization(tx, initial.eventId);
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${initial.eventId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM event_invites WHERE id = ${initial.id} FOR UPDATE`;
      const invite = await tx.eventInvite.findUnique({ where: { id: initial.id } });
      assertValidInvitation(invite, tokenHash);
      const user = await admit(tx);
      const current = await tx.eventMembership.findUnique({ where: { userId_eventId: { userId: user.id, eventId: invite.eventId } } });
      if (invite.acceptedAt) {
        if (invite.acceptedByUserId !== user.id || !current) throw invalidInvitation();
        return { membership: current, accountCreated: false };
      }
      assertClaimed(await tx.eventInvite.updateMany({ where: { ...liveInvite(invite.id), tokenHash }, data: { acceptedAt: new Date(), acceptedByUserId: user.id } }));
      const membership = current ?? await tx.eventMembership.create({ data: { userId: user.id, eventId: invite.eventId, role: invite.role } });
      return { membership, accountCreated: admit.isNewAccount };
    }, { timeout: 10_000, maxWait: 5000 });
    return { ok: true as const, eventId: result.membership.eventId, role: result.membership.role, accountCreated: result.accountCreated };
  }

  async revokeEventInvite(eventId: string, email: string, actorUserId?: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockEventOrganization(tx, eventId);
      await tx.$queryRaw`SELECT id FROM events WHERE id = ${eventId} FOR UPDATE`;
      const address = email.trim().toLowerCase();
      await tx.$queryRaw`SELECT id FROM event_invites WHERE "eventId" = ${eventId} AND email = ${address} FOR UPDATE`;
      if (actorUserId) await requireCurrentEventPermission(tx, { actor: { userId: actorUserId }, eventId, permission: 'member:manage' });
      const revoked = await tx.eventInvite.updateMany({ where: { eventId, email: address, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      if (!revoked.count) throw new NotFoundException('No pending invitation for that address');
      return { ok: true as const };
    });
  }

  /**
   * One organization per account, for now: accepting an invitation into a
   * second one used to add a second membership, after which the guard picked
   * either organization arbitrarily on every request.
   */
  private async assertNoOtherOrganization(tx: Prisma.TransactionClient, userId: string, organizationId: string): Promise<void> {
    const other = await tx.organizationMembership.findFirst({ where: { userId, organizationId: { not: organizationId } }, select: { organization: { select: { name: true } } } });
    if (other) throw new ConflictException(`This account already belongs to "${other.organization.name}"; one organization per account for now`);
  }

  /**
   * The account an invitation will be attached to — checked before any write.
   *
   * An account that already exists must be proven with its own password (see
   * `acceptInvite`). Returns a step to run inside the accepting transaction,
   * which creates the account when there is none, so the account and the
   * membership exist together or not at all.
   */
  private async prepareInvitee(email: string, dto: AcceptInviteDto) {
    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (existing) await assertOwnPassword(existing, dto.password);
    const passwordHash = existing ? null : await hash(dto.password, BCRYPT_ROUNDS);

    const admit = async (tx: Prisma.TransactionClient, shouldLockUpdate = false) => {
      if (!existing) return tx.user.create({ data: { email, name: dto.name, passwordHash } });
      const lock = shouldLockUpdate ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${existing.id} ${lock}`;
      const current = await tx.user.findUnique({ where: { id: existing.id } });
      if (!current?.isActive || current.passwordHash !== existing.passwordHash || current.sessionGeneration !== existing.sessionGeneration) throw invalidInvitation();
      return current;
    };
    return Object.assign(admit, { isNewAccount: existing === null });
  }

  async revokeInvite(organizationId: string, email: string, actorUserId?: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockOrganizationStanding(tx, { organizationId, mode: 'update' });
      const address = email.trim().toLowerCase();
      await tx.$queryRaw`SELECT id FROM organization_invites WHERE "organizationId" = ${organizationId} AND email = ${address} FOR UPDATE`;
      if (actorUserId) await requireCurrentOrganizationPermission(tx, { actor: { userId: actorUserId, email: '', platformRole: 'NONE' }, organizationId, permission: 'member:manage' });
      const revoked = await tx.organizationInvite.updateMany({ where: { organizationId, email: address, acceptedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
      if (!revoked.count) throw new NotFoundException('No pending invitation for that address');
      return { ok: true as const };
    });
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

/** The account's own password, or a 409 saying how to get it back. */
async function assertOwnPassword(
  user: { passwordHash: string | null; isActive: boolean },
  password: string,
): Promise<void> {
  const isOwnPassword = user.isActive && user.passwordHash !== null && (await compare(password, user.passwordHash));
  if (!isOwnPassword) {
    throw new ConflictException(
      'An account already exists for this address. Sign in with its password to accept, ' +
        'or reset the password first if it is not yours to know.',
    );
  }
}

/**
 * An invite still open at the moment of accepting. Accepting is a claim on
 * it, not a write after a check: a revoke landing between the two used to
 * be ignored, and the revoked person joined anyway (B87).
 */
function liveInvite(id: string) {
  return { id, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } };
}

function assertClaimed(claim: { count: number }): void {
  if (claim.count === 0) throw new BadRequestException('This invitation is no longer valid');
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invalidInvitation() { return new BadRequestException('This invitation is no longer valid'); }
function assertValidInvitation<T extends { tokenHash: string; revokedAt: Date | null; expiresAt: Date }>(invite: T | null, tokenHash?: string): asserts invite is T {
  if (!invite || invite.revokedAt || isExpired(invite.expiresAt)) throw invalidInvitation();
  if (tokenHash && invite.tokenHash !== tokenHash) throw invalidInvitation();
}

function isPendingOwnerInvite(invite: { role: string; acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date } | null): boolean {
  return Boolean(invite && invite.role === 'OWNER' && !invite.acceptedAt && !invite.revokedAt && !isExpired(invite.expiresAt));
}
