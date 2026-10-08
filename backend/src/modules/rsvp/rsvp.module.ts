import { Module } from '@nestjs/common';
import { InvitationsModule } from '../invitations/invitations.module';
import { HostRsvpController } from './host-rsvp.controller';
import { HostRsvpService } from './host-rsvp.service';
import { RsvpController } from './rsvp.controller';
import { RsvpService } from './rsvp.service';

@Module({
  imports: [InvitationsModule],
  controllers: [RsvpController, HostRsvpController],
  providers: [RsvpService, HostRsvpService],
  exports: [RsvpService],
})
export class RsvpModule {}
