import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { Permission } from '../../modules/access/access-policy';
import {
  AuthenticatedRequest,
  EVENT_SCOPE,
  EventScopeSource,
  IS_PUBLIC,
  ORGANIZATION_SCOPE,
  REQUIRED_PERMISSION,
  RequestActor,
  actorCan,
} from './actor';
import { AccessTokenClaims } from './auth.service';

/**
 * The guard that makes access-policy.ts real.
 *
 * It does two separate jobs, and keeping them separate is what makes the
 * policy a pure function:
 *
 *   1. **Authentication** — who is this? Verify the token, load the user.
 *   2. **Ownership** — what is their standing *on the resource in this URL*?
 *      Roles are read from the database per request, never trusted from a
 *      token that may have been minted before a membership changed.
 *
 * Only then does it ask the policy whether that actor may do this kind of
 * thing. A route with no @RequirePermission still needs a session; a route
 * marked @Public needs nothing.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest & {
      headers: Record<string, string | undefined>;
      params: Record<string, string | undefined>;
    }>();

    const scope = this.reflector.getAllAndOverride<EventScopeSource | undefined>(EVENT_SCOPE, [
      context.getHandler(),
      context.getClass(),
    ]);

    const isOrganizationScoped = this.reflector.getAllAndOverride<boolean>(ORGANIZATION_SCOPE, [
      context.getHandler(),
      context.getClass(),
    ]);

    const claims = await this.verifyToken(request.headers.authorization);
    const actor = await this.resolveActor(claims, request.params, scope, isOrganizationScoped);
    request.actor = actor;

    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRED_PERMISSION,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    if (!actorCan(actor, required)) {
      throw new ForbiddenException(`This account may not ${required}`);
    }
    return true;
  }

  private async verifyToken(header: string | undefined): Promise<AccessTokenClaims> {
    const [scheme, token] = (header ?? '').split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('A bearer token is required');
    }

    try {
      return await this.jwt.verifyAsync<AccessTokenClaims>(token);
    } catch {
      throw new UnauthorizedException('Token is invalid or expired');
    }
  }

  /**
   * Reads the actor's standing on the resource named in the URL. Both role
   * lookups come from the database on every request: a token minted before
   * someone was removed from an event must not still carry their old role.
   */
  private async resolveActor(
    claims: AccessTokenClaims,
    params: Record<string, string | undefined>,
    scope: EventScopeSource | undefined,
    isOrganizationScoped = false,
  ): Promise<RequestActor> {
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, email: true, platformRole: true, isActive: true },
    });
    if (!user?.isActive) throw new UnauthorizedException('Account is not active');

    const eventId = await this.eventIdFrom(params, scope);
    const { eventRole, organizationRole, organizationId } = await this.standingOf(
      user.id,
      eventId,
      isOrganizationScoped,
    );

    return {
      userId: user.id,
      email: user.email,
      platformRole: user.platformRole,
      eventRole,
      organizationRole,
      organizationId,
    };
  }

  /**
   * What this actor's standing is, by how the route is scoped: on one event,
   * on their own organization, or — for a route scoped to neither — nothing,
   * leaving only their platform role to grant anything.
   */
  private async standingOf(userId: string, eventId: string | undefined, isOrganizationScoped: boolean) {
    if (eventId) return this.rolesOn(userId, eventId);
    if (isOrganizationScoped) return this.organizationRoleOf(userId);
    return { eventRole: null, organizationRole: null, organizationId: null };
  }

  /**
   * The actor's own organization, for routes not scoped to one event.
   *
   * Read from their membership rather than a request parameter: taking an
   * organization id from the caller would let any authenticated account name
   * someone else's tenant.
   */
  private async organizationRoleOf(userId: string) {
    const membership = await this.prisma.organizationMembership.findFirst({
      where: { userId },
      select: { role: true, organizationId: true },
    });

    return {
      eventRole: null,
      organizationRole: membership?.role ?? null,
      organizationId: membership?.organizationId ?? null,
    };
  }

  /** Resolves the event a route acts on, however that route names it. */
  private async eventIdFrom(
    params: Record<string, string | undefined>,
    scope: EventScopeSource | undefined,
  ): Promise<string | undefined> {
    if (scope === 'invitationSlug' && params.slug) {
      const invitation = await this.prisma.invitation.findUnique({
        where: { slug: params.slug },
        select: { eventId: true },
      });
      return invitation?.eventId;
    }

    if (scope === 'listingSlug' && params.slug) {
      const listing = await this.prisma.eventListing.findUnique({
        where: { slug: params.slug },
        select: { eventId: true },
      });
      return listing?.eventId;
    }

    return params.eventId ?? params.id;
  }

  /** The roles this user holds on one event and its owning organization. */
  private async rolesOn(userId: string, eventId: string | undefined) {
    const empty = { eventRole: null, organizationRole: null, organizationId: null };
    if (!eventId) return empty;

    const organizationId = await this.organizationOf(eventId);

    const [eventMembership, organizationMembership] = await Promise.all([
      this.prisma.eventMembership.findUnique({
        where: { userId_eventId: { userId, eventId } },
        select: { role: true },
      }),
      organizationId
        ? this.prisma.organizationMembership.findUnique({
            where: { userId_organizationId: { userId, organizationId } },
            select: { role: true },
          })
        : null,
    ]);

    return {
      eventRole: eventMembership?.role ?? null,
      organizationRole: organizationMembership?.role ?? null,
      organizationId,
    };
  }

  private async organizationOf(eventId: string): Promise<string | null> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { organizationId: true },
    });
    return event?.organizationId ?? null;
  }
}


