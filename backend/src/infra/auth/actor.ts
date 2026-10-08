import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { EventRole, OrganizationRole, PlatformRole } from '@prisma/client';
import { Actor, Permission, can } from '../../modules/access/access-policy';

/**
 * Who is making this request, resolved once by the guard and carried on the
 * request from then on. Nothing downstream re-reads a token.
 */
export interface RequestActor {
  userId: string;
  email: string;
  platformRole: PlatformRole;
  /** Populated per request from the membership rows for the target resource. */
  organizationRole?: OrganizationRole | null;
  eventRole?: EventRole | null;
  organizationId?: string | null;
}

export interface AuthenticatedRequest {
  actor?: RequestActor;
  requestId?: string;
}

/** Marks a route reachable without a session — guest, buyer and vendor paths. */
export const IS_PUBLIC = 'isPublicRoute';
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** Declares what a route requires. The guard refuses anything not granted. */
export const REQUIRED_PERMISSION = 'requiredPermission';
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

/**
 * How a route identifies the event it acts on.
 *
 * Ownership cannot be inferred: `/events/:eventId/...` names it directly,
 * `/invitations/:slug/...` names it indirectly, and `/payments/:orderNumber`
 * not at all. Guessing from parameter names silently denies routes whose
 * shape the guard does not recognise, so each route that needs scoping says
 * so, and the default is the common case.
 */
export const EVENT_SCOPE = 'eventScope';
export type EventScopeSource = 'eventId' | 'id' | 'invitationSlug' | 'listingSlug';
export const EventScope = (source: EventScopeSource) => SetMetadata(EVENT_SCOPE, source);

/**
 * Marks a route scoped to an organization rather than one event.
 *
 * Without this, a route with no `:eventId` resolved no roles at all, so an
 * ordinary member was refused access to a list of their own events and only
 * platform staff could use it. The organization is taken from the actor's
 * membership, never from a query parameter the caller controls.
 */
export const ORGANIZATION_SCOPE = 'organizationScope';
export const OrganizationScope = () => SetMetadata(ORGANIZATION_SCOPE, true);

/** Injects the resolved actor into a handler. */
export const CurrentActor = createParamDecorator(
  (_data: unknown, context: ExecutionContext): RequestActor | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().actor,
);

/**
 * Whether this caller holds a permission, judged exactly as the guard judges
 * it: platform staff by platform role, everyone else by membership.
 *
 * For responses that show more to some callers than others — fees, guest
 * contact details — where the route itself is open to both. One function, so
 * a copy cannot drift from the guard: the vendors module's own copy forgot
 * platform staff, who then never saw fees.
 */
export function actorCan(actor: RequestActor, permission: Permission): boolean {
  return can(policyActorOf(actor), permission);
}

export function policyActorOf(actor: RequestActor): Actor {
  if (actor.platformRole !== PlatformRole.NONE) {
    return { kind: 'staff', role: actor.platformRole };
  }
  return {
    kind: 'member',
    organizationRole: actor.organizationRole ?? null,
    eventRole: actor.eventRole ?? null,
  };
}
