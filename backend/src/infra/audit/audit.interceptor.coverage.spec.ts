import { BadRequestException, CallHandler, ExecutionContext, InternalServerErrorException } from '@nestjs/common';
import { PlatformRole } from '@prisma/client';
import { Observable, lastValueFrom, of, throwError } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { AuditEntry, AuditService } from './audit.service';

/**
 * The trail records that a write happened — never a failed one, never a read,
 * and never what the write contained (docs/API.md "The audit trail").
 */
describe('AuditInterceptor (coverage)', () => {
  const recorded: AuditEntry[] = [];
  const audit = { record: (entry: AuditEntry) => recorded.push(entry) } as unknown as AuditService;

  const actor = { userId: 'u1', email: 'host@test.local', platformRole: PlatformRole.NONE, eventId: null, organizationId: 'o1' };

  const run = (request: Record<string, unknown>, handle: () => Observable<unknown> = () => of({ ok: true }), statusCode = 201) => {
    const context = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode }) }),
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle };
    return lastValueFrom(new AuditInterceptor(audit).intercept(context, next));
  };

  beforeEach(() => (recorded.length = 0));

  it.each([
    new BadRequestException('field: nope'),
    new InternalServerErrorException(),
  ])('records nothing when the handler fails with $status', async (error) => {
    const request = { method: 'POST', baseUrl: '/api/v1', route: { path: '/events/:eventId/guests' }, params: { eventId: 'e1' }, actor };

    await expect(run(request, () => throwError(() => error))).rejects.toBe(error);

    expect(recorded).toHaveLength(0);
  });

  it('records nothing for a successful read', async () => {
    await run({ method: 'GET', baseUrl: '/api/v1', route: { path: '/events/:eventId/guests' }, params: { eventId: 'e1' }, actor }, undefined, 200);

    expect(recorded).toHaveLength(0);
  });

  it('records nothing for a successful sign-in', async () => {
    await run({ method: 'POST', baseUrl: '/api/v1', route: { path: '/auth/login' }, params: {}, body: { email: 'a@test.local', password: 'secret' } });

    expect(recorded).toHaveLength(0);
  });

  it('records the route pattern and actor, never the body, params or filled-in URL', async () => {
    await run({
      method: 'POST',
      baseUrl: '/api/v1',
      route: { path: '/events/:eventId/tickets/:code/admit' },
      path: '/events/e1/tickets/SECRET123/admit',
      originalUrl: '/api/v1/events/e1/tickets/SECRET123/admit?q=Armen',
      params: { eventId: 'e1', code: 'SECRET123' },
      query: { q: 'Armen' },
      body: { guests: ['Armen'] },
      requestId: 'req-1',
      actor,
    });

    expect(recorded).toHaveLength(1);
    expect(Object.keys(recorded[0]).sort()).toEqual(
      ['action', 'at', 'email', 'eventId', 'method', 'organizationId', 'requestId', 'route', 'statusCode', 'userId'],
    );
    // The version prefix is left optional: docs/API.md shows the route without it.
    expect(recorded[0].route).toMatch(/^(\/api\/v1)?\/events\/:eventId\/tickets\/:code\/admit$/);
    expect(recorded[0]).toMatchObject({
      action: 'events.tickets.admit.create',
      method: 'POST',
      userId: 'u1',
      email: 'host@test.local',
      organizationId: 'o1',
      eventId: 'e1',
      statusCode: 201,
      requestId: 'req-1',
    });
    const serialized = JSON.stringify(recorded[0]);
    expect(serialized).not.toContain('SECRET123');
    expect(serialized).not.toContain('Armen');
  });

  it('falls back to the request path when no route pattern is known', async () => {
    await run({ method: 'DELETE', baseUrl: '/api/v1', path: '/events/e1/guests/g1', params: {}, actor });

    expect(recorded[0].route).toMatch(/^(\/api\/v1)?\/events\/e1\/guests\/g1$/);
  });

  it('records a capability-token caller with no account as null actor fields', async () => {
    await run({ method: 'POST', baseUrl: '/api/v1', route: { path: '/invitations/:slug/g/:token/rsvp' }, params: { slug: 's', token: 't' } });

    expect(recorded[0]).toMatchObject({ userId: null, email: null, organizationId: null, requestId: null });
  });
});
