import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import type { Request, Response } from 'express';
import { AuthenticatedRequest } from '../auth/actor';
import { AuditService } from './audit.service';
import { actionNameFor, isAuditable } from './audit';

/**
 * Records every write that someone has to account for.
 *
 * An interceptor rather than a call in each service, because the thing being
 * recorded is "an actor performed an action" — which the request already knows
 * and a service does not. Adding a new endpoint gets a trail entry without
 * anyone remembering to add one, which is the only version of this that stays
 * complete.
 *
 * Only successful writes. A rejected request changed nothing, and a trail full
 * of 400s is a log.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request & AuthenticatedRequest>();
    const route = routeOf(request);

    if (!isAuditable({ method: request.method, route })) return next.handle();

    return next.handle().pipe(
      tap(() => {
        const response = http.getResponse<Response>();

        // Fire and forget: the trail must never slow or fail the request it
        // describes. `void` is deliberate, and the service swallows its own
        // errors.
        void this.audit.record({
          action: actionNameFor({ method: request.method, route }),
          method: request.method,
          route,
          userId: request.actor?.userId ?? null,
          email: request.actor?.email ?? null,
          organizationId: request.actor?.organizationId ?? null,
          eventId: request.actor?.eventId ?? eventIdOf(request),
          statusCode: response.statusCode,
          requestId: request.requestId ?? null,
          at: new Date(),
        });
      }),
    );
  }
}

/**
 * The route pattern, not the filled-in URL.
 *
 * `/events/:eventId/guests` groups; `/events/clz123/guests` does not, and
 * recording the latter would make "who touched guest lists this week"
 * unanswerable.
 */
function routeOf(request: Request): string {
  const route = (request.route as { path?: string } | undefined)?.path;
  return `${request.baseUrl ?? ''}${route ?? request.path}`;
}

/**
 * The event a write acted on, when the route names one by id. Routes that
 * name it by invitation slug — publish, send, design edits — get theirs from
 * the guard, which resolved it to check permissions; without that they were
 * recorded with no event and missing from its trail.
 *
 * Recorded as its own field rather than left inside the route, because "show
 * me everything that happened to this event" is the question this trail exists
 * to answer.
 */
function eventIdOf(request: Request): string | null {
  const params = request.params as Record<string, string | undefined>;
  return params.eventId ?? params.id ?? null;
}
