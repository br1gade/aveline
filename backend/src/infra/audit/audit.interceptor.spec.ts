import { CallHandler, ExecutionContext } from '@nestjs/common';
import { PlatformRole } from '@prisma/client';
import { lastValueFrom, of } from 'rxjs';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';

/**
 * B57: a write on a route that names its event by invitation slug — publish,
 * send, every design edit — was recorded with no event, so it never appeared
 * in that event's audit trail.
 */
describe('AuditInterceptor', () => {
  const recorded: { eventId: string | null }[] = [];
  const audit = { record: (entry: { eventId: string | null }) => recorded.push(entry) } as unknown as AuditService;

  const write = (request: Record<string, unknown>) => {
    const context = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ statusCode: 201 }) }),
    } as unknown as ExecutionContext;
    const next: CallHandler = { handle: () => of({ ok: true }) };
    return lastValueFrom(new AuditInterceptor(audit).intercept(context, next));
  };

  const actor = (eventId: string | null) => ({
    userId: 'u1', email: 'host@test.local', platformRole: PlatformRole.NONE, eventId,
  });

  beforeEach(() => (recorded.length = 0));

  it('records the event the guard resolved from an invitation slug', async () => {
    await write({ method: 'POST', baseUrl: '/api/v1', route: { path: '/invitations/:slug/publish' }, params: { slug: 'anna-davit' }, actor: actor('event-1') });

    expect(recorded[0].eventId).toBe('event-1');
  });

  it('still records the event named in the path', async () => {
    await write({ method: 'PATCH', baseUrl: '/api/v1', route: { path: '/events/:eventId' }, params: { eventId: 'event-2' }, actor: actor(null) });

    expect(recorded[0].eventId).toBe('event-2');
  });
});
