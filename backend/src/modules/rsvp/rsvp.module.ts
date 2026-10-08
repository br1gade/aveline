import { Module } from '@nestjs/common';
import { InvitationsModule } from '../invitations/invitations.module';
import { RsvpController } from './rsvp.controller';
import { RsvpService } from './rsvp.service';

@Module({
  imports: [InvitationsModule],
  controllers: [RsvpController],
  providers: [RsvpService],
  exports: [RsvpService],
})
export class RsvpModule {}
