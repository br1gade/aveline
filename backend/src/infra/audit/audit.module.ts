import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AuditInterceptor } from './audit.interceptor';
import { AuditService } from './audit.service';

/**
 * The Mongo connection itself is provided globally by `AnalyticsModule`, so
 * both append-only stores share one client rather than opening a second pool
 * for a collection written once per request.
 *
 * Registered as an `APP_INTERCEPTOR` rather than in `main.ts` alongside the
 * serializer, because this one needs injection — and because a trail that has
 * to be wired up per route is a trail with holes in it.
 */
@Global()
@Module({
  providers: [AuditService, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
  exports: [AuditService],
})
export class AuditModule {}
