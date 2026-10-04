import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { EventsModule } from './modules/events/events.module';
import { GuestsModule } from './modules/guests/guests.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { RsvpModule } from './modules/rsvp/rsvp.module';
import { OperationsModule } from './modules/operations/operations.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    EventsModule,
    GuestsModule,
    InvitationsModule,
    RsvpModule,
    OperationsModule,
  ],
})
export class AppModule {}
