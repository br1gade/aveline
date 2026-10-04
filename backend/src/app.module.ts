import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { CacheModule } from './infra/cache/cache.module';
import { AnalyticsModule } from './infra/analytics/analytics.module';
import { EventsModule } from './modules/events/events.module';
import { GuestsModule } from './modules/guests/guests.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { RsvpModule } from './modules/rsvp/rsvp.module';
import { OperationsModule } from './modules/operations/operations.module';
import { PaymentsModule } from './modules/payments/payments.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CacheModule,
    AnalyticsModule,
    EventsModule,
    GuestsModule,
    InvitationsModule,
    RsvpModule,
    OperationsModule,
    PaymentsModule,
  ],
})
export class AppModule {}
