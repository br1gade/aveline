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
  OrganizationScopeOptions,
  actorCan,
} from './actor';
import { parseOrganizationSelector, resolveOrganizationContext } from './organization-context';
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
      rawHeaders?: string[];
      params: Record<string, string | undefined>;
    }>();

    const scope = this.reflector.getAllAndOverride<EventScopeSource | undefined>(EVENT_SCOPE, [
      context.getHandler(),
      context.getClass(),
    ]);

    const isOrganizationScoped = this.reflector.getAllAndOverride<OrganizationScopeOptions>(ORGANIZATION_SCOPE, [
      context.getHandler(),
      context.getClass(),
    ]);

    const claims = await this.verifyToken(request.headers.authorization);
    const selector = scope || isOrganizationScoped ? parseOrganizationSelector(request.headers, request.rawHeaders) : undefined;
    const actor = await this.resolveActor(claims, request.params, { scope, organization: isOrganizationScoped, selector, routeOrganizationId: isOrganizationScoped?.mode === 'platform' ? request.params.organizationId : undefined });
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
    selection: { scope?: EventScopeSource; organization?: OrganizationScopeOptions; selector?: string; routeOrganizationId?: string },
  ): Promise<RequestActor> {
    const user = await this.prisma.user.findUnique({
      where: { id: claims.sub },
      select: { id: true, email: true, platformRole: true, isActive: true, sessionGeneration: true },
    });
    if (!user?.isActive) throw new UnauthorizedException('Account is not active');
    // Issued before a password reset or "sign out everywhere": refused now,
    // not when its minutes run out.
    if ((claims.gen ?? 0) !== user.sessionGeneration) throw new UnauthorizedException('Session has ended');

    const eventId = await this.eventIdFrom(params, selection.scope);
    const organizationContext = await this.organizationContextOf(user, eventId, selection);
    const eventMembership = eventId ? await this.prisma.eventMembership.findUnique({
      where: { userId_eventId: { userId: user.id, eventId } }, select: { role: true },
    }) : null;

    return {
      userId: user.id,
      email: user.email,
      platformRole: user.platformRole,
      ...standingFields(organizationContext, eventMembership),
      organizationContext,
      eventId: eventId ?? null,
    };
  }

  private organizationContextOf(user: { id: string; platformRole: RequestActor['platformRole'] }, eventId: string | undefined,
    selection: { organization?: OrganizationScopeOptions; selector?: string; routeOrganizationId?: string }) {
    if (!eventId && !selection.organization) return null;
    return resolveOrganizationContext(this.prisma, {
      userId: user.id, platformRole: user.platformRole, eventId, selector: selection.selector, routeOrganizationId: selection.routeOrganizationId,
      mode: eventId ? 'event' : selection.organization?.mode ?? 'required',
      platformPermission: selection.organization?.permission,
    });
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

    if (scope === 'eventId') return params.eventId;
    if (scope === 'id') return params.id;
    return undefined;
  }

}

function standingFields(context: RequestActor['organizationContext'], eventMembership: { role: NonNullable<RequestActor['eventRole']> } | null) {
  return { eventRole: eventMembership?.role ?? null, organizationRole: context?.organizationRole ?? null, organizationId: context?.organizationId ?? null };
}
