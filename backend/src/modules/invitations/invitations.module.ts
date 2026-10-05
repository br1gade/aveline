import { Module } from '@nestjs/common';
import { ArrangementService } from './arrangement.service';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';
import { InvitationSenderService } from './sending/invitation-sender.service';
import { ReminderService } from './sending/reminder.service';

@Module({
  controllers: [InvitationsController],
  providers: [
    InvitationsService,
    ArrangementService,
    InvitationSenderService,
    ReminderService,
  ],
  exports: [
    InvitationsService,
    ArrangementService,
    InvitationSenderService,
    ReminderService,
  ],
})
export class InvitationsModule {}
