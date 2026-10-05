import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { loggingConfig } from './infra/logging/logging.config';
import { PrismaModule } from './prisma/prisma.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { RequestIdMiddleware } from './common/interceptors/request-id.middleware';
import { validateEnv } from './common/env.validation';
import { AuthModule } from './infra/auth/auth.module';
import { AuthGuard } from './infra/auth/auth.guard';
import { CacheModule } from './infra/cache/cache.module';
import { AnalyticsModule } from './infra/analytics/analytics.module';
import { HealthModule } from './infra/health/health.module';
import { JobsModule } from './infra/jobs/jobs.module';
import { StorageModule } from './infra/storage/storage.module';
import { EventsModule } from './modules/events/events.module';
import { GuestsModule } from './modules/guests/guests.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { RsvpModule } from './modules/rsvp/rsvp.module';
import { OperationsModule } from './modules/operations/operations.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { TicketingModule } from './modules/ticketing/ticketing.module';
import { PublicEventsModule } from './modules/public-events/public-events.module';
import { CommunicationsModule } from './modules/communications/communications.module';
import { MediaModule } from './modules/media/media.module';
import { DevicesModule } from './modules/devices/devices.module';
import { ExportsModule } from './modules/exports/exports.module';
import { PrivacyModule } from './modules/privacy/privacy.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { BillingModule } from './modules/billing/billing.module';
import { SeatingModule } from './modules/seating/seating.module';

@Module({
  imports: [
    // Configuration is validated here so a missing setting stops the boot
    // rather than surfacing on the first request that needs it.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),

    // Replaces Nest's logger everywhere, so the fifteen services already
    // using `new Logger(X)` emit structured lines with a request id without
    // any of them changing.
    LoggerModule.forRoot(loggingConfig(process.env)),

    // Public endpoints — RSVP, checkout, payment registration — are
    // unauthenticated by design, so the throttle is the only thing standing
    // between them and a script.
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'medium', ttl: 60_000, limit: 100 },
    ]),

    // ── infrastructure ──
    PrismaModule,
    CacheModule,
    AnalyticsModule,
    StorageModule,
    AuthModule,
    HealthModule,

    // ── domain ──
    EventsModule,
    GuestsModule,
    InvitationsModule,
    RsvpModule,
    OperationsModule,
    PaymentsModule,
    TicketingModule,
    PublicEventsModule,
    CommunicationsModule,
    MediaModule,
    DevicesModule,
    SeatingModule,
    BillingModule,
    VendorsModule,
    OrganizationsModule,
    ExportsModule,
    PrivacyModule,

    // Last: its sweeps depend on the domain modules above.
    JobsModule,
  ],
  providers: [
    // Authentication is default-on. A route opts out with @Public, which is
    // a visible decision in the code rather than an omission nobody notices.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
